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
var outgoingStream = [];
var incomingStream = [];

function createTransportAndAnswer(endpoint, offer) {    
    //Create an DTLS ICE transport in that enpoint
    const transport = endpoint.createTransport(offer);
    
    //Set RTP remote properties
    transport.setRemoteProperties(offer);
    
    //Create local SDP info
    const answer = offer.answer({
	dtls		: transport.getLocalDTLSInfo(),
	ice		: transport.getLocalICEInfo(),
	candidates	: endpoint.getLocalCandidates(),
	capabilities	: Capabilities
    });

    console.log(endpoint.getLocalCandidates());

    //Set RTP local  properties
    transport.setLocalProperties(answer);

    return [answer, transport];
}

var publisher_connection = undefined;
var viewer_count = 0;

module.exports = function(request, protocol, endpoint, ws_report)
{
    const connection = request.accept(protocol);
    
    connection.on('message', (frame) => {
	let msg = JSON.parse(frame.utf8Data);
	
	//Get cmd
	if (msg.cmd === "publish") {
	    publisher_connection = connection;
	    //Process the sdp
	    let offer = SDPInfo.process(msg.offer);
	    let [answer, transport] = createTransportAndAnswer(endpoint, offer);
	    
	    //For each stream offered
	    incomingStream = [];
	    for (let offered of offer.getStreams().values()) {
			//Create the remote stream into the transport
			const is = transport.createIncomingStream(offered);
			incomingStream.push(is);
	    }

	    //Send response
	    connection.sendUTF(JSON.stringify({ answer : answer.toString() }));
	    
		const timeout = setInterval(function() {
			if(ws_report) {
				// console.log("GETTING INCOMING STATS : ", incomingStream.length);

				for(let is of incomingStream) {
					let track = is.getVideoTracks()[0];
					let stats = track.getStats()['']['media'];

					// console.log(stats);
					// console.log(is);

					const report = {
						lost: 0,
						drop: 0,
						bitrate: 0,
						nack: 0,
						pli: 0
					};

					report.lost = stats["lostPackets"] ?? report.lost;
					report.drop = stats["dropPackets"] ?? report.drop;
					report.bitrate = stats["bitrate"] ?? report.bitrate;
					report.nack = stats["totalNACKs"] ?? report.nack;
					report.pli = stats["totalPLIs"] ?? report.pli;

					ws_report.sendUTF(JSON.stringify({ cmd: "medooze_incoming", stats: report }));
				}
			}
		}, 500);

	    //Close on disconnect
	    connection.on("close",() => {
			clearInterval(timeout[Symbol.toPrimitive]());
			if(transport) transport.stop();
			incomingStream.forEach(elt => elt.stop());
			publisher_connection = undefined;
	    });
	}
	else if (msg.cmd === "view") {
	    //Process the sdp
	    let offer = SDPInfo.process(msg.offer);
	    let [ answer, transport ] = createTransportAndAnswer(endpoint, offer);

	    // Create new transaction manager
	    const tm = new TransactionManager(connection);

	    // Create id
	    const id = "vm-viewer-" + (counter++);

	    // transport.dump("www/quic-relay/dumps/" + id + ".pcap");
	    // tm.event("url", "/quic-relay/dumps/" + id + ".csv");

	    transport.setBandwidthProbing(true);
	    transport.setProbingBitrateLimit(2500000);
	    transport.on("targetbitrate", (bitrate) =>	{
			if(connection) {
				connection.sendUTF(JSON.stringify({ name: id, target: bitrate/1000. }));
			}
	    });
	    
	    for(let is of incomingStream) {
			let os  = transport.createOutgoingStream({
				audio: true,
				video: true
			});
			
			outgoingStream.push(os);
			//Get local stream info
			const info = os.getStreamInfo();
			//Copy incoming data from the remote stream to the local one
			os.attachTo(is);
			//Add local stream info it to the answer
			answer.addStream(info);
	    }

	    //Send response
	    connection.sendUTF(JSON.stringify({ answer : answer.toString(), name: id }));
	    ++viewer_count;

	    if(publisher_connection) {
			publisher_connection.sendUTF(JSON.stringify({ viewer_count : viewer_count, name: id }));
	    }
	    
	    //Close on disconnect
	    connection.on("close",() => {
			if(transport) transport.stop();
			outgoingStream.forEach(elt => elt.stop());
			--viewer_count;
			if(publisher_connection)
				publisher_connection.sendUTF(JSON.stringify({ viewer_count : viewer_count }));
			});
	}
	else return;
    });
};
