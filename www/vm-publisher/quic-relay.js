const url = "wss://"+window.location.hostname+":"+window.location.port;
//Get our url
const href = new URL(window.location.href);
const autostart = href.searchParams.has("autostart");
const turn = href.searchParams.get("turn"); 
const turnUsername = href.searchParams.get("turnUsername"); 
const turnCredential = href.searchParams.get("turnCredential"); 

var ws_report = undefined;

var opts = {
    lines: 12, // The number of lines to draw
    angle: 0.15, // The length of each line
    lineWidth: 0.44, // 0.44 The line thickness
    pointer: {
	length: 0.8, // 0.9 The radius of the inner circle
	strokeWidth: 0.035, // The rotation offset
	color: '#A0A0A0'     // Fill color
    },
    limitMax: true,
    colorStart: '#28c1d1', // Colors
    colorStop: '#28c1d1', // just experiment with them
    strokeColor: '#F0F0F0', // to see which ones work best for you
    generateGradient: false,
    gradientType: 0
};
var targets = document.querySelectorAll('.gaugeChart'); // your canvas element
var gauges = [];
for (var i=0;i<targets.length;++i)
{
    gauges[i] = new Gauge(targets[i]).setOptions (opts); // create sexy gauge!
    gauges[i].animationSpeed = 10000; // set animation speed (32 is default value)
    gauges[i].set (0); // set actual value
}
gauges[0].maxValue = 1920; 
gauges[1].maxValue = 1080; 
gauges[2].maxValue = 30; 
gauges[3].maxValue = 2000; 

var texts =  document.querySelectorAll('.gaugeChartLabel');
var ssrcs;
let pc;
let csv;

function addVideoForStream(stream,muted)
{
    //Create new video element
    const video = document.querySelector (muted ? "#local" : "#remote");
    //Set same id
    video.streamid = stream.id;
    //Set src stream
    video.srcObject = stream;
    //Set other properties
    video.autoplay = true;
    video.playsInline = true;
    video.muted = muted;
}

function start_stats() 
{
	console.log('start_stats');
    var prev,prevFrames = 0,prevBytes = 0;

	const video = document.querySelector ("#remote");
	const stream = video.srcObject;
    var track = stream.getVideoTracks()[0];
    //Update stats
    let interval = setInterval(async function(){
	var results;

	/*try {
	    //For ff
	    results = await pc.getStats(track);
	} catch(e) {
	    //For chrome
	    results = await pc.getStats();
	}*/

	let senders = pc.getSenders();
	let kbps_total = 0;

	for(let sender of senders) {
		results = await sender.getStats();
		// console.log("Timestamp");
	//Get results
	results.forEach(result => {
	    if (result.type==="outbound-rtp") {
			if(result.isRemote) return;
			// console.log("here");
			//Get timestamp delta

			if (prev && prev.has(result.id)) {

			//Store this ts
			// prev = result.timestamp;
			var delta = result.timestamp - prev.get(result.id).timestamp;
			prevBytes = prev.get(result.id).bytesSent;
			prevFrames = prev.get(result.id).framesSent;

			//Get values
			var width = result.frameWidth;
			var height = result.frameHeight;
			var fps =  (result.framesSent - prevFrames) * 1000 / delta;
			var kbps = (result.bytesSent - prevBytes) * 8 / delta;
			//Store last values
			// prevFrames = result.framesSent;
			// prevBytes  = result.bytesSent;
			//If first
			if (delta == result.timestamp || isNaN(fps) || isNaN (kbps)) return;

			for (var i=0;i<targets.length;++i)
				gauges[i].animationSpeed = 10000000; // set animation speed (32 is default value)

			let bitrate_value = Math.floor(kbps);
			let fps_value = Math.floor(fps);

			console.log(bitrate_value);

			kbps_total += bitrate_value;
		
			gauges[0].set(width);
			gauges[1].set(height);
			gauges[2].set(fps_value);
			
			texts[0].innerText = width;
			texts[1].innerText = height;
			texts[2].innerText = Math.floor(fps);
			}
 	    }
	});
		prev = results;

	}

	gauges[3].set(kbps_total);
	texts[3].innerText =  Math.floor(kbps_total);
	if(ws_report) {
		// console.log("send : ", JSON.stringify({cmd: "publisher_bitrate", bitrate: bitrate_value }));
		ws_report.send(JSON.stringify({cmd: "bitrate", bitrate: kbps_total }));
	}
    }, 1000);

    //Stop stats on ended track
    track.addEventListener("ended", (event) =>	clearInterval(interval) );
};

if (!autostart) {
    document.querySelector('#start').addEventListener("click", () => {
	document.querySelector('#start').style.display = "none";
	start();
    });
}
else window.onload = start();

function preferCodec(codecs, mimeType) {
	let otherCodecs = [];
	let sortedCodecs = [];
	let count = codecs.length;
  
	codecs.forEach((codec) => {
	  if (codec.mimeType === mimeType) {
		sortedCodecs.push(codec);
	  } else {
		// otherCodecs.push(codec);
	  }
	});
  
	return sortedCodecs.concat(otherCodecs);
}

function start()
{
    //Connect with websocket
    const ws = new WebSocket(url, "vm-relay");

    //Crete transaction manager 
    const tm = new TransactionManager(ws);

    //Listen for events
    tm.on("event", (event) =>{
	console.dir(event);
	if (event.name == "url") csv = event.data;
    });
    
    //Start on open
    ws.onopen = async () => {
	// const supported = navigator.mediaDevices.getSupportedConstraints();
	// console.log(supported);

	const stream = await navigator.mediaDevices.getUserMedia({ "video": true });
	// console.log(stream);

	addVideoForStream(stream, false);
	
	ws_report = new WebSocket("wss://134.59.133.57:9000", "publisher");
	ws_report.onopen = () => { console.log("ws report open"); };

	//Create new managed pc 
	pc = new RTCPeerConnection();
	pc.addEventListener('icecandidate', e => console.log(e));
	pc.addEventListener("connectionstatechange", (event) => {
		console.log(pc.connectionState);
		if(ws_report) {
			ws_report.send(JSON.stringify({cmd: "pc_state", state: pc.connectionState}));
		}
	});

	/*stream.getTracks().forEach(async track => {
		const sender = await pc.addTrack(track, stream);
		const params = sender.getParameters();
		params.encodings[0].maxBitrate = 2500000; // 2.5 mbits

		console.log(params.encodings, params.encodings.length);

		await sender.setParameters(params);
	});*/

	/*let send_encodings = [
		{rid: 'q', scaleResolutionDownBy: 4.0 },
		{rid: 'h', scaleResolutionDownBy: 2.0 },
		{rid: 'f' }
	  ];*/

	/*let send_encodings = [
	{rid: 'q', scaleResolutionDownBy: 4.0, maxBitrate: 500000 },
	{rid: 'm', scaleResolutionDownBy: 2.0, maxBitrate: 1000000 },
	{rid: 'h', maxBitrate: 2500000 }
	];*/
	  
	/*let send_encodings = [
	{rid: 'q', scaleResolutionDownBy: 4.0, scalabilityMode: 'L1T3'},
	{rid: 'h', scaleResolutionDownBy: 2.0, scalabilityMode: 'L1T3' },
	{rid: 'f', scalabilityMode: 'L1T3'}
	];*/

	/*let send_encodings = [
		{ scalabilityMode: 'S3T3' }
	]*/

	let send_encodings = [
		{ maxBitrate: 2500000 }
	];

	console.log(stream.getVideoTracks());
	let transceiver = pc.addTransceiver(stream.getVideoTracks()[0], {
		direction: 'sendonly',
		sendEncodings: send_encodings
	});

	/*const kind = transceiver.sender.track.kind;
	let sendCodecs = RTCRtpSender.getCapabilities(kind).codecs;
	let recvCodecs = RTCRtpReceiver.getCapabilities(kind).codecs;

    if (kind === "video") {
	  const mimeType = "video/H264";

      sendCodecs = preferCodec(sendCodecs, mimeType);
      recvCodecs = preferCodec(recvCodecs, mimeType);
		console.log(sendCodecs, recvCodecs);

	transceiver.setCodecPreferences([...sendCodecs, ...recvCodecs]);
    }*/
	
	const offer = await pc.createOffer();
	console.log(offer);

	await pc.setLocalDescription(offer);

	ws.send(JSON.stringify({ cmd: "publish", offer: offer.sdp }));

	document.querySelector('#close').style.display = "initial";
    };

    ws.onmessage = (msg) => {
	let ans = JSON.parse(msg.data);
	if(ans.answer) {
		console.log(ans.answer);
	    pc.setRemoteDescription(new RTCSessionDescription({
		type: 'answer',
		sdp: ans.answer
	    }));

		// ws_report.send(JSON.stringify({ cmd : "new_publisher" }));

		start_stats();
	}
	if(ans.viewer_count) {
	    console.log(`viewer count : ${ans.viewer_count}`);
	    ws_report.send(JSON.stringify({ cmd: "viewer_count", count: ans.viewer_count }));
	}
    };

    ws.onclose = async () => {
		pc.close();
		pc = undefined;
		
		if(ws_report) {
			ws_report.close();
			ws_report = undefined;
		}

		stream?.getTracks().forEach(function(track) {
			track.stop();
		});
	};

    // document.querySelector('#close').addEventListener("click", () => { pc.close(); ws.close(); });
};
