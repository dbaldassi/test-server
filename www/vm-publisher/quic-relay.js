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
    var prev = 0,prevFrames = 0,prevBytes = 0;

	const video = document.querySelector ("#remote");
	const stream = video.srcObject;
    var track = stream.getVideoTracks()[0];
    //Update stats
    let interval = setInterval(async function(){
	var results;

	try {
	    //For ff
	    results = await pc.getStats(track);
	} catch(e) {
	    //For chrome
	    results = await pc.getStats();
	}
	//Get results
	for (let result of results.values()) {
	    if (result.type==="outbound-rtp") {
			console.log("here");
			//Get timestamp delta
			var delta = result.timestamp - prev;
			//Store this ts
			prev = result.timestamp;

			//Get values
			var width = result.frameWidth;
			var height = result.frameHeight;
			var fps =  (result.framesSent - prevFrames) * 1000 / delta;
			var kbps = (result.bytesSent - prevBytes) * 8 / delta;
			//Store last values
			prevFrames = result.framesSent;
			prevBytes  = result.bytesSent;
			//If first
			if (delta == result.timestamp || isNaN(fps) || isNaN (kbps)) return;

			for (var i=0;i<targets.length;++i)
				gauges[i].animationSpeed = 10000000; // set animation speed (32 is default value)

			let bitrate_value = Math.min(Math.floor(kbps), 2000);
			let fps_value = Math.min(Math.floor(fps),30);
		
			gauges[0].set(width);
			gauges[1].set(height);
			gauges[2].set(fps_value);
			gauges[3].set(bitrate_value);

			texts[0].innerText = width;
			texts[1].innerText = height;
			texts[2].innerText = Math.floor(fps);
			texts[3].innerText =  Math.floor(kbps);

			if(ws_report) {
				console.log("send");
				ws_report.send(JSON.stringify({cmd: "publisher_bitrate", bitrate: bitrate_value }));
			}
 	    }
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
	const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: true });
	addVideoForStream(stream, false);
	
	//Create new managed pc 
	pc = new RTCPeerConnection();
	pc.addEventListener('icecandidate', e => console.log(e));

	stream.getTracks().forEach(track => pc.addTrack(track, stream));
	
	const offer = await pc.createOffer();
	await pc.setLocalDescription(offer);

	ws.send(JSON.stringify({ cmd: "publish", offer: offer.sdp }));

	document.querySelector('#close').style.display = "initial";
    };

    ws.onmessage = (msg) => {
	let ans = JSON.parse(msg.data);
	if(ans.answer) {
	    pc.setRemoteDescription(new RTCSessionDescription({
		type: 'answer',
		sdp: ans.answer
	    }));

	    ws_report = new WebSocket("wss://134.59.133.57:9000");
	    ws_report.onopen = () => {
		console.log("ws report open");
		ws_report.send(JSON.stringify({ cmd : "new_publisher" }));
	    };

		start_stats();
	}
	if(ans.viewer_count) {
	    console.log(`viewer count : ${ans.viewer_count}`);
	    ws_report.send(JSON.stringify({ cmd: "viewer_count", count: ans.viewer_count }));
	}
    };

    ws.onclose = async () =>{
	//Create urls
	const csvUrl = "https://" + window.location.hostname + ":" + window.location.port + csv;
	const bweUrl = "https://medooze.github.io/bwe-stats-viewer/?url=" + encodeURIComponent(csvUrl);

	const div = document.createElement("div");
	div.innerHTML = "<a href='" + bweUrl + "'>BWE viewer</a>&nbsp;<a href='" + csvUrl + "'>Download CSV</a>";
	document.body.appendChild(div);
	const iframe = document.createElement("iframe");
	iframe.src = bweUrl;
	iframe.height = "100%";
	document.body.appendChild(iframe);
	document.body.removeChild(document.body.children[0]);
    };

    document.querySelector('#close').addEventListener("click", () => { pc.close(); ws.close(); });
};
