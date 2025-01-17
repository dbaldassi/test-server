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
    gauges[i].set(0); // set actual value
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
	let width_max = 0,height_max = 0, fps_max = 0;

	let rtt = 0, rtt_n = 0;

	for(let sender of senders) {
		results = await sender.getStats();
		//Get results
		results.forEach(result => {
			if (result.type==="outbound-rtp") {
				if(result.isRemote) return;

				if (prev && prev.has(result.id)) {
					//Store this ts
					// prev = result.timestamp;
					let delta = result.timestamp - prev.get(result.id).timestamp;
					prevBytes = prev.get(result.id).bytesSent;
					prevFrames = prev.get(result.id).framesSent;

					//Get values
					let width = result.frameWidth;
					let height = result.frameHeight;
					let fps =  (result.framesSent - prevFrames) * 1000 / delta;
					let kbps = (result.bytesSent - prevBytes) * 8 / delta;
					//Store last values
					// prevFrames = result.framesSent;
					// prevBytes  = result.bytesSent;
					//If first
					if (delta == result.timestamp || isNaN(fps) || isNaN (kbps)) return;

					for (let i=0;i<targets.length;++i)
						gauges[i].animationSpeed = 10000000; // set animation speed (32 is default value)

					let bitrate_value = Math.floor(kbps);
					let fps_value = Math.floor(fps);

					kbps_total += bitrate_value;
									
					width_max = Math.max(width_max, width);
					height_max = Math.max(height_max, height);
					fps_max = Math.max(fps_max, fps_value);
				}
			}
			else if(result.type === "remote-inbound-rtp") {
				let rttmp = result.roundTripTime * 1000; // convert in ms
				rtt += Math.floor(rttmp);
				rtt_n += 1;
			}
		});
		prev = results;
	}

	gauges[0].set(width_max);
	gauges[1].set(height_max);
	gauges[2].set(fps_max);
	gauges[3].set(kbps_total);
					
	texts[0].innerText = width_max;
	texts[1].innerText = height_max;
	texts[2].innerText = Math.floor(fps_max);
	texts[3].innerText =  Math.floor(kbps_total);

	if(pc.report) {
		let cmd = {
			cmd: 'bitrate',
			bitrate: kbps_total,
			fps: fps_max,
			rtt: Math.floor(rtt / rtt_n),
			res: `${width_max}x${height_max}`
		};
		pc.report.send(JSON.stringify(cmd));
	}

    }, 500);

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

function break_number(n) {
	const size = 4;
	let tab = [];

	for(let i = 0; i < size; ++i) {
		tab.push(n & 0xff);
		n = n >> 8;
	}

	return tab;
}

async function transform(frame, controller) {
	// Data should start with four bytes to signal the upcoming metadata at end of frame
	const magic_value = [0xca, 0xfe, 0xba, 0xbe];

	let now = Date.now();

	const data = [
		...magic_value,
		...break_number(now)
	];

	// console.log(frame);

	// Create DataView from Array buffer
	const frame_length = frame.data.byteLength;
	const buffer = new ArrayBuffer(frame_length + data.length);
	const view_buffer = new DataView(buffer);
	const view_frame = new DataView(frame.data);

	// Copy old frame buffer to new frame buffer and then append the metadata
	// at the end of the buffer
	for (let i = 0; i < frame_length; ++i) {
		view_buffer.setUint8(i, view_frame.getUint8(i));
	}

	data.forEach((elt, idx) => view_buffer.setUint8(frame_length + idx, elt));

	// Set the new frame buffer
	frame.data = buffer;

	// Send the frame
	controller.enqueue(frame);
}

async function on_open(ws) {
	// Get url params
	const scenar = href.searchParams.get("scenar") ?? "max2500";
	const codec = href.searchParams.get("codec") ?? "vp8";
	const max_bitrate = href.searchParams.get("max") ?? "2500";

	console.log("Params : ", scenar, codec, max_bitrate, href.searchParams.get("scenar"));

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

	// get video tracks
	const videoTrack = stream.getVideoTracks()[0];

	addEventListener("rtctransform", (event) => {
		const transformer = new TransformStream({transform});
		event.transformer.readable
    		.pipeThrough(transformer)
    		.pipeTo(event.transformer.writable);
	});

	// Create peerconnection according to selected scenar
	const pc = await create_peerconnection[scenar](videoTrack);
	// Listen to connection state to report to monitor
	pc.addEventListener("connectionstatechange", (event) => {
		console.log(pc.connectionState);
		// report it
		if(pc.report) pc.report.send(JSON.stringify({cmd: "pc_state", state: pc.connectionState}));
	});

	let sender = pc.getSenders()[0];
  	const senderStreams = sender.createEncodedStreams();
  	const transformStream = new TransformStream({ transform: transform  });
 	senderStreams.readable
      .pipeThrough(transformStream)
      .pipeTo(senderStreams.writable);
  
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
