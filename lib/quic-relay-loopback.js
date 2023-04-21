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
    const port = candidates[0].port;
    
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

    candidates[0].port = port;
    
    return [answer, transport];
}

// const probing = 0;

function view(endpoint, connection, msg) {
    //Process the sdp    
    let offer = SDPInfo.process(msg.offer);
    let probing = msg.probing;
    let constant_probing = msg.constant_probing;
    
    let [ answer, transport ] = createTransportAndAnswer(endpoint, offer);
    
    console.log({probing:probing, constant_probing:constant_probing});

    //Create fake h264 encoder
    const fake = VideoCodecs.createFakeH264VideoEncoder({ fps: 30, bitrate: 300 });

    //Create fake incomming video track
    const incomintTrack = fake.createIncomingStreamTrack("fake");
   
    transport.setBandwidthProbing(!!probing);

    if(!!probing) {
	transport.setProbingBitrateLimit(probing * 1000);
	transport.on("targetbitrate", (bitrate) => {
	    console.log("targetbitrate", bitrate/1000);
	    const encodingBitrate = Math.min(bitrate/1000, probing) ;
	    fake.setBitrate(30, encodingBitrate);
	    transport.setBandwidthProbing(encodingBitrate < probing);
	});
    } else {
	fake.setBitrate(30, constant_probing);
    }
    
    //Get stream id from remote id
    const outgoingStreamId = "remote-fake-h264";

    let outgoingStream = transport.createOutgoingStream(outgoingStreamId);

    const outgoing = outgoingStream.createTrack(incomintTrack.getMedia());
    connection.transporder = outgoing.attachTo(incomintTrack);

    answer.addStream(outgoingStream.getStreamInfo());

    // Create id
    const id = "quic-relay-" + Date.now() + "-" + (counter++);
    transport.dump("www/quic-relay/dumps/" + id + ".pcap");
    
    connection.sendUTF(JSON.stringify({
	answer : answer.toString(),
	url: "/quic-relay/dumps/" + id + ".csv"
    }));
    
    //Close on disconnect
    connection.on("close",() => {
	console.log("closing ws");
	transport.stop();
	outgoing.stop();
	incomintTrack.stop();
	fake.stop();
    });
}

function port(endpoint, connection, msg) {
    let port = endpoint.candidates.port;
    console.log(endpoint.candidates);
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
