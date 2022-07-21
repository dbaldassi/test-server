const TransactionManager = require("transaction-manager");
//Get the Medooze Media Server interface
const MediaServer = require("medooze-media-server");
const VideoCodecs = require("h264-encoder-mockup");

//Get Semantic SDP objects
const SemanticSDP	= require("semantic-sdp");
const SDPInfo		= SemanticSDP.SDPInfo;
const MediaInfo		= SemanticSDP.MediaInfo;
const CandidateInfo	= SemanticSDP.CandidateInfo;
const DTLSInfo		= SemanticSDP.DTLSInfo;
const ICEInfo		= SemanticSDP.ICEInfo;
const StreamInfo	= SemanticSDP.StreamInfo;
const TrackInfo		= SemanticSDP.TrackInfo;
const Direction		= SemanticSDP.Direction;
const CodecInfo		= SemanticSDP.CodecInfo;


VideoCodecs.enableDebug(false);
VideoCodecs.enableUltraDebug(false);

const Capabilities = {
	audio: {
		codecs: ["opus"],
		extensions: [
			//"http://www.ietf.org/id/draft-holmer-rmcat-transport-wide-cc-extensions-01",
			"http://www.webrtc.org/experiments/rtp-hdrext/abs-send-time",
			"urn:ietf:params:rtp-hdrext:sdes:rtp-stream-id",
			"urn:ietf:params:rtp-hdrext:sdes:mid"
		],
	},
	video : {
		codecs		: ["h264;packetization-mode=1"],
		rtx		: true,
		rtcpfbs		: [
			{ "id": "transport-cc"},
			{ "id": "ccm", "params": ["fir"]},
			{ "id": "nack"},
			{ "id": "nack", "params": ["pli"]}
		],
		extensions	: [
			"urn:3gpp:video-orientation",
			"http://www.ietf.org/id/draft-holmer-rmcat-transport-wide-cc-extensions-01",
			"urn:ietf:params:rtp-hdrext:sdes:repaired-rtp-stream-id",
			"urn:ietf:params:rtp-hdrext:sdes:rtp-stream-id",
			"urn:ietf:params:rtp-hdrext:sdes:mid",
		]
	}
};

let counter = 0;

function createTransportAndAnswer(endpoint, offer) {    
    //Create an DTLS ICE transport in that enpoint
    const transport = endpoint.createTransport(offer);
    
    //Set RTP remote properties
    transport.setRemoteProperties(offer);

    // change port
    let candidates = endpoint.getLocalCandidates();
    candidates[0].port = 3479;

    console.log(transport.getLocalICEInfo());
    
    //Create local SDP info
    const answer = offer.answer({
	dtls		: transport.getLocalDTLSInfo(),
	ice		: transport.getLocalICEInfo(),
	candidates	: candidates,
	capabilities	: Capabilities
    });

    console.log(endpoint.getLocalCandidates());

    //Set RTP local  properties
    transport.setLocalProperties(answer);

    return [answer, transport];
}

function view(endpoint, connection, msg) {
    //Process the sdp
    let offer = SDPInfo.process(msg.offer);
    let [ answer, transport ] = createTransportAndAnswer(endpoint, offer);

    // Create new transaction manager
    const tm = new TransactionManager(connection);

    //Create fake h264 encoder
    const fake = VideoCodecs.createFakeH264VideoEncoder({ fps: 30, bitrate: 300 });

    //Create fake incomming video track
    const incomintTrack = fake.createIncomingStreamTrack("fake");
    
    // Create id
    const id = "quic-relay-" + Date.now() + "-" + (counter++);

    transport.dump("www/quic-relay/dumps/" + id + ".pcap");

    tm.event("url", "/quic-relay/dumps/" + id + ".csv");

    transport.setBandwidthProbing(true);
    transport.setProbingBitrateLimit(2000000);
    transport.on("targetbitrate", (bitrate) => {
	console.log("targetbitrate", bitrate/1000);
	const encodingBitrate = Math.min(bitrate/1000, 2000) ;
	fake.setBitrate(30, encodingBitrate);
	// transport.setBandwidthProbing(encodingBitrate < 2000);
    });
    
    //Get stream id from remote id
    const outgoingStreamId = "remote-fake-h264";
    //Get stream
    let outgoingStream = transport.createOutgoingStream({id: outgoingStreamId,
							 audio: false,
							 video: true });

    const outgoing = outgoingStream.getVideoTracks()[0];
    connection.transporder = outgoing.attachTo(incomintTrack);
    
    answer.addStream(outgoingStream.getStreamInfo());

    //Send response
    connection.sendUTF(JSON.stringify({ answer : answer.toString() }));
    //Close on disconnect
    connection.on("close",() => {
	if(transport) transport.stop();
	// outgoing.stop();
	incomintTrack.stop();
	fake.stop();
    });
}

function port(endpoint, connection, msg) {
    let port = endpoint.candidates.port;
    console.log(port);
    connection.sendUTF(JSON.stringify({ port: port }));
}

module.exports = function(request, protocol, endpoint) {
    const connection = request.accept(protocol);
        
    connection.on('message', (frame) => {	
	let msg = JSON.parse(frame.utf8Data);

	console.log(msg);
	
	if(msg.cmd === "view") view(endpoint, connection, msg);
	else if(msg.cmd === "port") port(endpoint, connection, msg);
	else connection.sendUTF(JSON.stringify({ error: "Unknown command" }));
    });
};
