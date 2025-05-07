const VideoCodecs = require("h264-encoder-mockup");

//Get Semantic SDP objects
const SemanticSDP	= require("semantic-sdp");
const SDPInfo		= SemanticSDP.SDPInfo;

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

class Participant {
    constructor(connection) {
        this.connection = connection;
        this.incomingStreams = [];
        this.outgoingStreams = [];
    }

    addIncomingStream(stream) {
        this.incomingStreams.push(stream);
    }

    hasIncomingStreams() {
        return this.incomingStreams.length > 0;
    }

    removeIncomingStream(stream) {
        const index = this.incomingStreams.indexOf(stream);
        if (index > -1) {
            this.incomingStreams.splice(index, 1);
        }
    }

    removeAllIncomingStreams() {
        this.incomingStreams.forEach(stream => {
            stream.stop();
        });
        this.incomingStreams = [];
    }

    addOutgoingStream(stream) {
        this.outgoingStreams.push(stream);
    }

    removeOutgoingStream(stream) {
        const index = this.outgoingStreams.indexOf(stream);
        if (index > -1) {
            this.outgoingStreams.splice(index, 1);
        }
    }

    removeAllOutgoingStreams() {
        this.outgoingStreams.forEach(stream => {
            stream.stop();
        });
        this.outgoingStreams = [];
    }
}

let rooms = new Map();

class Room {
    static getMaxParticipants() {
        return 6; 
    }

    constructor() {
        this.participants = new Map();
    }

    addParticipant(id, connection) {
        const participant = new Participant(connection);
        participant.id = id;
        // Notify all participants about the new participant
        this.participants.forEach((p) => {
            p.connection.sendUTF(JSON.stringify({ cmd: "new_participant", id }));
        });
        // Send all participants to the new participant
        this.participants.forEach((p) => {
            connection.sendUTF(JSON.stringify({ cmd: "new_participant", id: p.id }));
            if(p.hasIncomingStreams()) {
                connection.sendUTF(JSON.stringify({ cmd: "new_publisher", id: p.id }));
            }
            else {
                console.log(p);
            }
        });

        this.participants.set(id, participant);
        return participant;
    }

    removeParticipant(id) {
        this.participants.delete(id);
        // Notify all participants about the removed participant
        this.participants.forEach((p) => {
            p.connection.sendUTF(JSON.stringify({ cmd: "remove_participant", id }));
        });
    }

    participantExists(id) {
        return this.participants.has(id);
    }

    getNumberOfParticipants() {
        return this.participants.size;
    }

    isFull() {
        return this.getNumberOfParticipants() >= Room.getMaxParticipants();
    }

    getParticipants() {
        return Array.from(this.participants.values());
    }

}

function createRoom(id, connection) {
    if (!rooms.has(id)) {
        const room = new Room();
        rooms.set(id, room);
        connection.sendUTF(JSON.stringify({ cmd: "create", success: true, id: id, message: "Room created" }));
    } else {
        connection.sendUTF(JSON.stringify({ cmd: "create", success: false, message: "Room already exists", id: id }));
    }
}

function joinRoom(roomId, connection) {
    if (rooms.has(roomId)) {
        const room = rooms.get(roomId);
        if (!room.isFull()) {
            const participantId = `participant-${room.getNumberOfParticipants()+1}`;
            const participant = room.addParticipant(participantId, connection);
            connection.roomId = roomId;
            connection.participantId = participantId;
            connection.sendUTF(JSON.stringify({ cmd: "join", success: true, id: participantId, message: "Joined room" }));

            connection.on('close', () => {
                room.removeParticipant(participantId);
                connection.roomId = null;
                connection.participantId = null;
            });
        } else {
            connection.sendUTF(JSON.stringify({ cmd: "join", success: false, message: "Room is full", id: roomId }));
        }
    } else {
        connection.sendUTF(JSON.stringify({ cmd: "join", success: false, message: "Room does not exist", id: roomId }));
    }
}

function listRooms(connection) {
    const roomList = Array.from(rooms.keys()).map(roomId => ({
        id: roomId,
        participants: rooms.get(roomId).getNumberOfParticipants()
    }));
    connection.sendUTF(JSON.stringify({ cmd: "list", rooms: roomList }));
}

function leaveRoom(roomId, participantId, connection) {
    if (rooms.has(roomId)) {
        const room = rooms.get(roomId);
        room.removeParticipant(participantId);
        connection.sendUTF(JSON.stringify({ cmd: "leave", success: true, message: "Left room", id: roomId }));
        connection.roomId = null;
        connection.participantId = null;
    } else {
        connection.sendUTF(JSON.stringify({ cmd: "leave", success: false, message: "Room does not exist", id: roomId }));
    }
}

function deleteRoom(roomId, connection) {
    if (rooms.has(roomId)) {
        rooms.delete(roomId);
        connection.sendUTF(JSON.stringify({ cmd: "delete", success: true, message: "Room deleted", id: roomId }));
    } else {
        connection.sendUTF(JSON.stringify({ cmd: "delete", success: false, message: "Room does not exist", id: roomId }));
    }
}

function publishToRoom(sdp, connection, endpoint) {
    if(!connection.roomId || !connection.participantId) {
        connection.sendUTF(JSON.stringify({ cmd: "publish", success: false, message: "Not in a room, join a room first !" }));
        return;
    }

    const room = rooms.get(connection.roomId);
    const participant = room.participants.get(connection.participantId);

    // Process the sdp
    let offer = SDPInfo.process(sdp);
    let [answer, transport] = createTransportAndAnswer(endpoint, offer);

    for (let offered of offer.getStreams().values()) {
        //Create the remote stream into the transport
        const is = transport.createIncomingStream(offered);
        participant.addIncomingStream(is);
    }

    connection.sendUTF(JSON.stringify({ cmd: "answer", answer : answer.toString(), id:connection.participantId }));

    connection.on("close",() => {
        if(transport) transport.stop();
        participant.streams.forEach(elt => elt.stop());
        participant.removeAllIncomingStreams();
        room.removeParticipant(connection.participantId);
    });

    // notify all participants about the new publisher except the publisher
    room.getParticipants().forEach((p) => {
        if (p.id !== connection.participantId) {
            p.connection.sendUTF(JSON.stringify({ cmd: "new_publisher", id: connection.participantId }));
        }
    });
}

function viewRemoteParticipant(remoteId, sdp, connection, endpoint) {
    if(!connection.roomId || !connection.participantId) {
        connection.sendUTF(JSON.stringify({ cmd: "publish", success: false, message: "Not in a room, join a room first !" }));
        return;
    }

    const room = rooms.get(connection.roomId);
    const participant = room.participants.get(connection.participantId);
    const remote = room.participants.get(remoteId);
    if(!remote) {
        connection.sendUTF(JSON.stringify({ cmd: "view", success: false, message: "Remote participant not found" }));
        return;
    }

    // Process the sdp
    let offer = SDPInfo.process(sdp);
    let [ answer, transport ] = createTransportAndAnswer(endpoint, offer);

    transport.setBandwidthProbing(true);
    transport.setProbingBitrateLimit(2500000);
        
    for(let is of remote.incomingStreams) {
        let os  = transport.createOutgoingStream({
            audio: true,
            video: true
        });

        participant.addOutgoingStream(os);

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
    });

    connection.on("close",() => {
        if(transport) transport.stop();
        participant.incomingStream.forEach(elt => elt.stop());
        participant.outgoingStream.forEach(elt => elt.stop());
        participant.removeAllOutgoingStreams();
        participant.removeAllIncomingStreams();
        room.removeParticipant(participantId);
    });

    connection.sendUTF(JSON.stringify({ cmd: "answer", answer : answer.toString(), id: remoteId }));
}

module.exports = function(request, protocol, endpoint, ws_report)
{
    const connection = request.accept(protocol);
    // console.log("connection : ", connection);

    connection.on('message', (frame) => {
    let msg = JSON.parse(frame.utf8Data);
    
    if(msg.cmd === "create") createRoom(msg.roomId, connection);
    else if(msg.cmd === "join") joinRoom(msg.roomId, connection);
    else if(msg.cmd === "leave") leaveRoom(msg.roomId, msg.participantId, connection);
    else if(msg.cmd === "list") listRooms(connection);
    else if(msg.cmd === "delete") deleteRoom(msg.roomId, connection);
    else if(msg.cmd === "publish") publishToRoom(msg.offer, connection, endpoint);
    else if(msg.cmd === "view") viewRemoteParticipant(msg.remoteId, msg.offer, connection, endpoint);
    else return;
    });
};
