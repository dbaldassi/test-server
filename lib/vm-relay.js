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
		codecs		: ["vp8", "vp9", "h264;packetization-mode=1"],
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

const CapabilitiesIncoming = {
	audio : {
		codecs		: ["opus"],
		extensions	: [
			//"http://www.ietf.org/id/draft-holmer-rmcat-transport-wide-cc-extensions-01",
			"http://www.webrtc.org/experiments/rtp-hdrext/abs-send-time",
			"urn:ietf:params:rtp-hdrext:sdes:rtp-stream-id",
			"urn:ietf:params:rtp-hdrext:sdes:mid"
		],
	},
	video : {
		codecs		: ["vp8", "vp9", "h264;packetization-mode=1"],
		rtx		: true,
		rtcpfbs		: [
			{ "id": "goog-remb"},
			{ "id": "transport-cc"},
			{ "id": "ccm", "params": ["fir"]},
			{ "id": "nack"},
			{ "id": "nack", "params": ["pli"]}
		],
		extensions	: [
			"urn:3gpp:video-orientation",
			"http://www.ietf.org/id/draft-holmer-rmcat-transport-wide-cc-extensions-01",
			"http://www.webrtc.org/experiments/rtp-hdrext/abs-send-time",
			"urn:ietf:params:rtp-hdrext:sdes:repaired-rtp-stream-id",
			"urn:ietf:params:rtp-hdrext:sdes:rtp-stream-id",
			"urn:ietf:params:rtp-hdrext:sdes:mid",
			"http://tools.ietf.org/html/draft-ietf-avtext-framemarking-07"
		],
		simulcast	: true
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
	// transport.enableSenderSideEstimation(false);
    
    //Create local SDP info
    const answer = offer.answer({
	dtls		: transport.getLocalDTLSInfo(),
	ice		: transport.getLocalICEInfo(),
	candidates	: endpoint.getLocalCandidates(),
	capabilities	: CapabilitiesIncoming
    });

    // endpoint.getLocalCandidates();

    //Set RTP local  properties
    transport.setLocalProperties(answer);
	transport.enableSenderSideEstimation(true);

    return [answer, transport];
}

var publisher_connection = undefined;
var viewer_count = 0;

module.exports = function(request, protocol, endpoint, ws_report)
{
    const connection = request.accept(protocol);
	// console.log("connection : ", connection);

    connection.on('message', (frame) => {
	let msg = JSON.parse(frame.utf8Data);

	console.log("Got msg", msg);
	
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
				for(let is of incomingStream) {
					const report = {
						lost: 0,
						drop: 0,
						bitrate: 0,
						nack: 0,
						pli: 0
					};

					let track = is.getVideoTracks()[0];
					let encodings = [''];
					if(track.encodings && track.encodings.size > 1) {
						encodings = track.encodings.keys();
					}
					
					for(let encoding of encodings) {
						let stats = track.getStats()[encoding]['media'];

						report.lost += stats["lostPackets"] ?? 0;
						report.drop += stats["dropPackets"] ?? 0;
						report.bitrate += Math.floor((stats["bitrate"] ?? 0) / 1000);
						report.nack += stats["totalNACKs"] ?? 0;
						report.pli += stats["totalPLIs"] ?? 0;
					}

					console.log(report);

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

	    // transport.dump("www/vm-relay/dumps/" + id + ".pcap");
	    // tm.event("url", "/quic-relay/dumps/" + id + ".csv");

	    transport.setBandwidthProbing(true);
	    transport.setProbingBitrateLimit(2500000);
	    
	    for(let is of incomingStream) {
			let os  = transport.createOutgoingStream({
				audio: true,
				video: true
			});

			outgoingStream.push(os);

			//Get local stream info
			const info = os.getStreamInfo();
			//Copy incoming data from the remote stream to the local one
			connection.transponder = os.attachTo(is)[0];
			//Add local stream info it to the answer
			answer.addStream(info);
	    }

		transport.on("targetbitrate", (bitrate) =>	{
			// console.log(connection.transponder);
			connection.transponder.setTargetBitrate(bitrate);
			// console.log("Viewer : ", id, bitrate, connection.transponder.getSelectedEncoding(), connection.transponder.getSelectedLayer()?.simulcastIdx, connection.transponder.getAvailableLayers());
			// console.log("Viewer : ", connection.transponder.getAvailableLayers(), connection.transponder.getSelectedEncoding(), connection.transponder.getSelectedLayer());

			if(connection) {
				connection.sendUTF(JSON.stringify({ name: id, target: bitrate/1000., rid: connection.transponder.getSelectedEncoding() }));
			}
	    });

	    //Send response
	    connection.sendUTF(JSON.stringify({ answer : answer.toString(), name: id }));
	    ++viewer_count;

	    if(publisher_connection) {
			publisher_connection.sendUTF(JSON.stringify({ viewer_count : viewer_count, name: id }));
	    }
	    
	    //Close on disconnect
	    connection.on("close",(code, desc) => {
			console.log(`${id} disconnected : ${code} ${desc}`);

		        --viewer_count;
		        --counter;
		console.log({a:0, viewer_count});
		
			if(transport) transport.stop();
			outgoingStream.forEach(elt => elt.stop());
		
		if(publisher_connection) {
		    		console.log({a:1, viewer_count});
		    publisher_connection.sendUTF(JSON.stringify({ viewer_count : viewer_count }));
		}
			});
	}
	else return;
    });
};
