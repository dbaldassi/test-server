const Express          = require("express");
const CORS             = require("cors");
const FS               = require("fs");
const HTTPS            = require("https");
const Path             = require("path");
const WebSocketServer  = require ("websocket").server;
const WebSocketClient  = require ("websocket").client;
const os               = require("os");
const osutils          = require("os-utils");
const ChildProcess     = require('child_process');
const { exec, execSync } = require('node:child_process');

const SemanticSDP	= require("semantic-sdp");
const MediaInfo		= SemanticSDP.MediaInfo;
const CodecInfo		= SemanticSDP.CodecInfo;

//Get the Medooze Media Server interface
const MediaServer = require("medooze-media-server");

const letsencrypt = false;

//Check 
// if (process.argv.length!=2)
//    throw new Error("Missing IP address\nUsage: node index.js");

// const out = execSync("ip -4 -o addr show dev enp8s0 | awk '{print $4}' | cut -d'/' -f1", { shell : true });
const out = execSync("ip -4 -o addr show dev enp39s0 | awk '{print $4}' | cut -d'/' -f1", { shell : true }); 

//Get ip
// const ip = process.argv[2];

const ip = out.toString().trim();
console.log("IP : ", ip);

let PORT = 8084;
let udp_port = 0;

if(process.argv.length === 2) {
    MediaServer.setPortRange(10000,10100);
}
else if(process.argv[2] === "sub") {
    PORT = 9084;
    MediaServer.setPortRange(20000,20100);
    udp_port = 0;
}
else if(process.argv[2] === "sub2") {
    PORT = 11084;
    MediaServer.setPortRange(30000,30100);
    udp_port = 1;
}


//Create UDP server endpoint
const endpoint = MediaServer.createEndpoint(ip);
console.log(endpoint);

//Enable debug
MediaServer.enableDebug(false);
MediaServer.enableUltraDebug(false);

//Create rest api
const rest = Express();
rest.use(CORS());
rest.use(Express.static("www"));

// Load the demo handlers
const handlers = {
    "simulcast"	        : require("./lib/simulcast.js"),
    "transceivers"	        : require("./lib/PeerConnectionServerDemo.js"),
    "partyline"	        : require("./lib/PartyLine.js"),
    "twcc"		        : require("./lib/twcc.js"),
    "quic-relay"	        : require("./lib/quic-relay.js"),
    "quic-relay-loopback"	: require("./lib/quic-relay-loopback.js"),
    "port"	                : require("./lib/port.js"),
    "vm-relay"	        : require("./lib/vm-relay.js"),
    "vm-visio"	        : require("./lib/vm-visio.js"),
    "cascade"           : require("./lib/cascade.js"),
};

let client = new WebSocketClient({ tlsOptions: { rejectUnauthorized: false }});
let client_connection = undefined;

function wss(server)
{
    //Create websocket server
    const wssServer = new WebSocketServer ({
	httpServer: server,
	autoAcceptConnections: false
    });

    wssServer.on("request", (request) => {
	request.on('requestAccepted', () => console.log('Request accepted'));
	request.on('requestRejected', () => console.log('Request rejected'));

	//Get protocol for demo
	var protocol = request.requestedProtocols[0];

	console.log ("-Got request for: " + protocol);
	// console.log (request);
	//If nor found
	if (!handlers.hasOwnProperty (protocol))
	    //Reject connection
	    return request.reject ();

	//Process it
	handlers[protocol] (request, protocol, endpoint, client_connection);
    });
}

//Create HTTP server
if (letsencrypt) {
    //Use greenlock to get ssl certificate
    const gle = require("greenlock-express").init({
	packageRoot: __dirname,
	configDir: "./greenlock.d",
	maintainerEmail : "sergio.garcia.murillo@gmail.com",
	cluster: false
    });
    gle.ready((gle)=>wss(gle.httpsServer()));
    gle.serve(rest);
} else {
    //Load certs
    const options = {
	key	: FS.readFileSync ("server.key"),
	cert	: FS.readFileSync ("server.cert")
    };

    //Manualy starty server
    const server = HTTPS.createServer (options, rest).listen(PORT);
    //Launch wss server
    wss(server);
}

function get_cpu_usage(count, connection) {
    osutils.cpuUsage(function(usage) {
	// console.log(usage);
	let obj = {
	    cmd : "vm_stats",
	    stats : {
		"time": count,
		"cpu": usage, 
		"freemem": os.freemem(),
		"totalmem": os.totalmem()
	    }
	};		

	connection.sendUTF(JSON.stringify(obj));		
    });
}

function get_free_cmd(count, connection) {
    exec("free | head -n2 | tail -n1 | awk '{print $2\" \"$3\" \"$6}'", (err, output) => {
	if(err) {
	    console.error("ERROR : ", err);
	    return;
	}

	stats = output.split(" ").map((x) => parseInt(x) / 1024);
	
	let obj = {
	    cmd : "free_stats",
	    stats : {
		"time": count,
		"free_total": stats[0],
		"free_used": stats[1],
		"free_buffcache": stats[2]
	    }
	};

	connection.sendUTF(JSON.stringify(obj));
    });
}

function get_iplink_stats(count, connection) {
    exec('ip -s link show enp8s0', (err, output) => {
	if (err) {
	    console.error("could not execute command: ", err);
	    return;
	}

	// console.log("Output: \n", output);

	const BYTES = 0, PACKET = 1, ERRORS = 2, DROPPED = 3, MISSED = 4, MCAST = 5;

	let report = {
	    cmd: "iplink_stats",
	    rx : {},
	    tx : {}
	};

	let lines = output.split('\n');
	lines = lines.slice(3);
	const rx = lines.shift();
	lines.shift();
	const tx = lines.shift();

	let rx_values = rx.replace(/\s+/g, ' ').trim().split(' ');
	report.rx.packet = rx_values[PACKET];
	report.rx.dropped = rx_values[DROPPED];
	report.rx.errors = rx_values[ERRORS];
	report.rx.missed = rx_values[MISSED];

	let tx_values = tx.replace(/\s+/g, ' ').trim().split(' ');
	report.tx.packet = tx_values[PACKET];
	report.tx.dropped = tx_values[DROPPED];
	report.tx.errors = tx_values[ERRORS];
	report.tx.missed = tx_values[MISSED];

	// console.log(report);
	connection.sendUTF(JSON.stringify(report));
    });	
}

function spawn_process() {
    console.log("Spawing process allocating memory");
    const process_path = "/home/ap/test-server-uptodate/process";
    ChildProcess.spawn(process_path, [], { detached: true });
}

function kill_process(count) {
    ChildProcess.exec("ps -fauxwww | grep -e \"./process$\" | awk '{print $2}'", (err, out) => {
	if(err) {
	    console.error(err);
	    return;
	}
	let pids = out.split('\n');
	while(pids.length > 0 && count > 0) {
	    let num = Math.floor(Math.random() * (pids.length - 1));
	    ChildProcess.exec(`kill -USR1 ${pids[num]}`, (error, output) => {
		if(error) console.error(error);
		else console.log(output);
	    });

	    --count; pids.splice(num, 1);
	}
    });
}

const Cascade = require("./lib/streamer.js");

let udp_ports = [3456, 4567];

function cascade(msg) {
    for(let ip of msg.ip) {
	console.log("cascade :", udp_ports);
	console.log("Root Create streamer : ", ip);
	let streamer = MediaServer.createStreamer();
	let session = streamer.createSession(Cascade.media_info, {
	    remote : {
		ip: ip,
		port: 3456
		// port: udp_ports.shift()
	    },
	    // local : {
	    // 	port : 4456
	    // },
	    noRTCP : true
	});

	// session.getOutgoingStreamTrack().detach();
	// session.getIncomingStreamTrack().stop();
	
	for(let is of Cascade.incomingStream) {
	    // console.log(is.getTracks('video'));
	    session.getOutgoingStreamTrack().attachTo(is.getTracks('video')[0]);
	}

	Cascade.streamers.push(session);
    }
}

function subcascade(msg) {    
    const video = new MediaInfo("video","video");
    video.addCodec(new CodecInfo("vp8",96));

    console.log("cascade :", udp_ports);
    
    let streamer = MediaServer.createStreamer();
    let session = streamer.createSession(MediaInfo.expand(video), {
	local : {
	    port: 3456
	    // port : udp_ports[udp_port]
	},
	noRTCP : true
    });

    Cascade.streamers.push(session);
}

// const host = "wss://134.59.133.57:9000";
const host = "wss://192.168.1.179:9000";
const protocol = "medooze";

client.on('connectFailed', function(error) {
    console.log('Connect Error: ' + error.toString());
    setTimeout(() => client.connect(host, protocol), 5000);
});

client.on('connect', function(connection) {
    console.log("Connected to monitor");
    client_connection = connection;

    connection.on('message', (message) => {
	const msg = JSON.parse(message.utf8Data);

	if(msg.cmd === "spawn")     spawn_process();
	else if(msg.cmd === "kill") kill_process(msg.count);
	else if(msg.cmd === "cascade") cascade(msg);
	else if(msg.cmd === "subcascade") subcascade(msg);
    });

    connection.sendUTF(JSON.stringify({
	cmd: "ip",
	ip: ip
    }));

    var count = 0;

    setInterval(function() {
	get_cpu_usage(count, connection);
	// get_iplink_stats(count, connection);
        get_free_cmd(count, connection);
	
	count += 500;
    }, 500);

    connection.on("close", () => {
	console.log("Connection to monitor closed");
	setTimeout(() => client.connect(host, protocol), 5000);
    });
});

client.connect(host, protocol);

//Try to clean up on exit
const onExit = (e) => {
    if (e) console.error(e);
    MediaServer.terminate();
    process.exit();
};

process.on("uncaughtException"	, onExit);
process.on("SIGINT"		, onExit);
process.on("SIGTERM"		, onExit);
process.on("SIGQUIT"		, onExit);
