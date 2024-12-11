const url = "wss://"+window.location.hostname+":"+window.location.port;
//Get our url
const href = new URL(window.location.href);
const autostart = href.searchParams.has("autostart");

const opts = {
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

function start_stats(pc) 
{
	var texts =  document.querySelectorAll('.gaugeChartLabel');

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
	if(pc.report) pc.report.send(JSON.stringify({cmd: "bitrate", bitrate: kbps_total }));

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

async function on_open(ws) {
	// Get url params
	const scenar = href.searchParams.get("scenar") ?? "max2500";
	const codec = href.searchParams.get("codec") ?? "vp8";
	const max_bitrate = href.searchParams.get("max") ?? "2500";

	console.log("Params : ", scenar, codec, max_bitrate)

	// Create object to map peerconnection config function
	const create_peerconnection = {
		"normal": async (stream) => config_normal(stream, codec),
		"max2500": async (stream) => config_max(stream, 2500 * 1000, codec),
		"max": async (stream) => config_max(stream, parseInt(max_bitrate) * 1000, codec),
		"simulcast" : async (stream) => config_simulcast(stream, codec)
	};

	// Get webcam
	const stream = await navigator.mediaDevices.getUserMedia({ "video": true });

	// Add video to HTML element
	addVideoForStream(stream, false);

	// Create peerconnection according to selected scenar
	const pc = await create_peerconnection[scenar](stream);
	// Listen to connection state to report to monitor
	pc.addEventListener("connectionstatechange", (event) => {
		console.log(pc.connectionState);
		// report it
		if(pc.report) ws_report.send(JSON.stringify({cmd: "pc_state", state: pc.connectionState}));
	});

	// Send publish command to start pc negociation
	ws.send(JSON.stringify({ cmd: "publish", offer: pc.localDescription.sdp }));

	document.querySelector('#close').style.display = "initial";

	// Ref
	ws.pc = pc;
}

function on_message(ws, msg) {
	// Parse json
	let ans = JSON.parse(msg.data);

	// Received SDP answer
	if(ans.answer) {
		//Set remote description
	    ws.pc.setRemoteDescription(new RTCSessionDescription({
		type: 'answer',
		sdp: ans.answer
	    }));

		// Open websocket to monitor to report stats
		ws.pc.report = new WebSocket("wss://134.59.133.57:9000", "publisher");
		ws.pc.report.onopen = () => console.log("ws report open");;

		// Start collecting webrtc stats
		start_stats(ws.pc);
	}

	// Received viewer count event
	if(ans.viewer_count) {
	    console.log(`viewer count : ${ans.viewer_count}`);
	    ws.pc.report.send(JSON.stringify({ cmd: "viewer_count", count: ans.viewer_count }));
	}
}

function on_close(ws) {
	// Close peerconnection
	ws.pc.close();
	
	// Close websocket report 
	if(ws.pc.report) {
		ws.pc.report.close();
		ws.pc.report = undefined;
	}

	// nullify peerconnection ref
	ws.pc = undefined;

	// Get stream object
	const video = document.querySelector ("#remote");
	const stream = video.srcObject;

	/// close tracks
	stream?.getTracks().forEach((track) => track.stop());
}

function start()
{
    //Connect with websocket
    const ws = new WebSocket(url, "vm-relay");

    // Start on open
    ws.onopen = async () => on_open(ws);
    ws.onmessage = (msg) => on_message(ws, msg);
    ws.onclose = async () => on_close(ws);

    // document.querySelector('#close').addEventListener("click", () => { pc.close(); ws.close(); });
};
