const url = "wss://"+window.location.hostname+":"+window.location.port;
//Get our url
const href = new URL(window.location.href);
const autostart = href.searchParams.has("autostart");
const turn = href.searchParams.get("turn"); 
const turnUsername = href.searchParams.get("turnUsername"); 
const turnCredential = href.searchParams.get("turnCredential"); 

var ws_report = false;
var viewer_id = undefined;

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
gauges[0].maxValue = 1280; 
gauges[1].maxValue = 720; 
gauges[2].maxValue = 30; 
gauges[3].maxValue = 1024; 

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

function addRemoteTrack(event) 
{
    var prev = 0,prevFrames = 0,prevBytes = 0;
    console.debug("ontrack", event);
    const stream = event.streams[0];
    //Play it
    addVideoForStream(stream);
    //Get track
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
	for (let result of results.values())
	{
	    if (result.type === "inbound-rtp")
	    {
		//Get timestamp delta
		var delta = result.timestamp-prev;
		//Store this ts
		prev = result.timestamp;

		//Get values
		var width = track.width || remote.videoWidth;//result.stat("googFrameWidthReceived");
		var height = track.height || remote.videoHeight;//result.stat("googFrameHeightReceived");
		var fps = (result.framesDecoded-prevFrames)*1000/delta;
		var kbps = (result.bytesReceived-prevBytes)*8/delta;

		if(ws_report) {
			ws_report.send(JSON.stringify({ cmd : "viewerbitrate", 
				name: viewer_id, 
				bitrate: kbps,
				fps: fps
			}));
		}

		//Store last values
		prevFrames = result.framesDecoded;
		prevBytes  = result.bytesReceived;
		//If first
		if (delta==result.timestamp || isNaN(fps) || isNaN (kbps))
		    return;

		for (var i=0;i<targets.length;++i)
		    gauges[i].animationSpeed = 10000000; // set animation speed (32 is default value)
		gauges[0].set(width);
		gauges[1].set(height);
		gauges[2].set(Math.min(Math.floor(fps)   ,30));
		gauges[3].set(Math.min(Math.floor(kbps) ,1024));
		texts[0].innerText = width;
		texts[1].innerText = height;
		texts[2].innerText = Math.floor(fps);
		texts[3].innerText =  Math.floor(kbps);
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
	
	//Create new managed pc 
	pc = new RTCPeerConnection();
	pc.addEventListener('connectionstatechange', event => {
	    console.log("local pc : " + pc.connectionState);
	});
	
	pc.addTransceiver("video", { direction: "recvonly" });
	pc.addTransceiver("audio", { direction: "recvonly" });
			  
	//On new remote tracks
	pc.ontrack = (event) => addRemoteTrack(event);

	const offer = await pc.createOffer();
	await pc.setLocalDescription(offer);

	ws.send(JSON.stringify({ cmd: "view", offer: offer.sdp }));

	document.querySelector('#close').style.display = "initial";
    };

    ws.onmessage = async (msg) => {
		let ans = JSON.parse(msg.data);
		if(ans.answer) {
			pc.setRemoteDescription(new RTCSessionDescription({
				type: 'answer',
				sdp: ans.answer
			}));

			viewer_id = ans.name;

			ws_report = new WebSocket("wss://134.59.133.57:9000");
	    	ws_report.onopen = () => {
				console.log("ws report open");
				ws_report.send(JSON.stringify({ cmd : "new_viewer", name: ans.name }));
			}
		}
		
		else if(ans.target) {
			if(ws_report) {
				ws_report.send(JSON.stringify({ cmd : "viewertarget", 
					name: ans.name, 
					target: ans.target
				}));
			}
		}

    };

    ws.onclose = async () => {};

    document.querySelector('#close').addEventListener("click", () => { pc.close(); ws.close(); });
};
