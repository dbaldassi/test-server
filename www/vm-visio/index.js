
const wsUrl = "wss://" + window.location.hostname + ":" + window.location.port; 
const roomId = "room1"; // ID de la salle
const localVideo = document.getElementById("localVideo");
const remoteVideos = [
    document.getElementById("remoteVideo1"),
    document.getElementById("remoteVideo2"),
    document.getElementById("remoteVideo3"),
    document.getElementById("remoteVideo4"),
    document.getElementById("remoteVideo5"),
];

const href = new URL(window.location.href);
// get URL parameters  
const viewOnly = href.searchParams.has("viewOnly");

let localStream;
let localId;
let peerConnections = {};
let ws;

// Initialiser WebSocket
function initWebSocket() {
    ws = new WebSocket(wsUrl, "vm-visio");

    ws.onopen = () => {
        console.log("WebSocket connected");
        ws.send(JSON.stringify({ cmd: "create", roomId }));
    };

    ws.onmessage = async (message) => {
        const data = JSON.parse(message.data);

        if (data.cmd === "new_participant") {
            console.log("New participant:", data.id);
        } else if (data.cmd === "answer") {
            await handleAnswer(data.answer, data.id);
        } else if (data.cmd === "create") {
            ws.send(JSON.stringify({ cmd: "join", roomId }));
        } else if (data.cmd === "join") {
            if(!data.success) console.error.error(data.message);
            localId = data.id;
            console.log("Joined room with ID:", localId, data);
            if(!viewOnly) publish();
        } else if (data.cmd === "new_publisher") {
            subscribe(data.id);
        } else if(data.cmd === "remove_participant") {
            console.log("Participant left:", data.id);
            const pc = peerConnections[data.id];
            if (pc) {
                pc.close();
                pc.remoteVideo.srcObject = null;
                pc.remoteVideo = null;
                delete peerConnections[data.id];
            }
        }
    };

    ws.onclose = () => {
        console.log("WebSocket disconnected");
    };
}

// Obtenir le flux local
async function initLocalStream() {
    try {
        localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
        localVideo.srcObject = localStream;
    } catch (error) {
        console.error("Error accessing media devices:", error);
    }
}

function publish() {
    // Créer une offre
    const pc = new RTCPeerConnection();
    // Ajouter le flux local
    localStream.getTracks().forEach((track) => pc.addTrack(track, localStream));

    pc.createOffer().then((offer) => {
        return pc.setLocalDescription(offer);
    }).then(() => {
        ws.send(JSON.stringify({ cmd: "publish", offer: pc.localDescription.sdp }));
    }).catch((error) => {
        console.error("Error creating offer:", error);
    });

    peerConnections[localId] = pc;
    console.log("Publishing with ID:", localId, peerConnections);
}

function subscribe(participantId) {
    console.log("Subscribing to participant:", participantId);
    // Créer une PeerConnection pour le participant
    const pc = new RTCPeerConnection();
    // Gérer les flux entrants
    pc.ontrack = (event) => {
        if(event.track.kind !== "video") return;

        const remoteVideo = remoteVideos.find((video) => !video.srcObject);
        console.log("Remote video:", remoteVideo);
        if (remoteVideo) {
            console.log("ON TRACK", localId);
            remoteVideo.srcObject = event.streams[0];
            pc.remoteVideo  = remoteVideo;
        }
    };

    pc.addTransceiver("video", { direction: "recvonly" });
	pc.addTransceiver("audio", { direction: "recvonly" });

    // Envoyer une offre
    pc.createOffer().then((offer) => {
        return pc.setLocalDescription(offer);
    }).then(() => {
        ws.send(JSON.stringify({ cmd: "view", offer: pc.localDescription.sdp, remoteId: participantId }));
    }).catch((error) => {
        console.error("Error creating offer:", error);
    });

    peerConnections[participantId] = pc;
}

// Gérer une réponse
async function handleAnswer(answer, participantId) {
    console.log("Received answer from participant:", participantId);

    const pc = peerConnections[participantId];
    await pc.setRemoteDescription(new RTCSessionDescription({
        type: "answer",
        sdp: answer
    }));
}

// Initialiser l'application
async function init() {
    if(!viewOnly) await initLocalStream();
    else remoteVideos.unshift(localVideo);

    initWebSocket();
}

init();