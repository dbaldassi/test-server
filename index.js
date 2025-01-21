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
const { exec } = require('node:child_process')

//Get the Medooze Media Server interface
const MediaServer = require("medooze-media-server");

const PORT = 8084;
const letsencrypt = false;

//Check 
if (process.argv.length!=3)
	 throw new Error("Missing IP address\nUsage: node index.js <ip>");
//Get ip
const ip = process.argv[2];

//Restrict port range
MediaServer.setPortRange(10000,10100);

//Create UDP server endpoint
const endpoint = MediaServer.createEndpoint(ip);

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
	})	
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

const host = "wss://134.59.133.57:9000";
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
	});

	var count = 0

	setInterval(function() {
		get_cpu_usage(count, connection);
		get_iplink_stats(count, connection);

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
