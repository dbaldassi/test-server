
////////////////////////////////////////////////////
/////////// UTILITIES //////////////////////////////
////////////////////////////////////////////////////

function prefer_codec(codecs, mimeType) {
	let otherCodecs = [];
	let sortedCodecs = [];
  
	codecs.forEach((codec) => {
	  if (codec.mimeType === mimeType) sortedCodecs.push(codec);
	  // else otherCodecs.push(codec);
	});
  
	return sortedCodecs.concat(otherCodecs);
}

function set_codec_preferences(transceiver, codec) {
    const kind = transceiver.sender.track.kind;
	let send_codecs = RTCRtpSender.getCapabilities(kind).codecs;
	let recv_codecs = RTCRtpReceiver.getCapabilities(kind).codecs;

    if (kind === "video") {
        const mimeType = `video/${codec}`;

        send_codecs = prefer_codec(send_codecs, mimeType);
        recv_codecs = prefer_codec(recv_codecs, mimeType);

        transceiver.setCodecPreferences([...send_codecs, ...recv_codecs]);
    }
}

////////////////////////////////////////////////////
////////////// NORMAL //////////////////////////////
////////////////////////////////////////////////////

async function config_normal(stream, codec) {
    let pc = new RTCPeerConnection();

	let transceiver = pc.addTransceiver(stream.getVideoTracks()[0], { direction: 'sendonly' });

	if(codec) set_codec_preferences(transceiver, codec);
	
	const offer = await pc.createOffer();

	await pc.setLocalDescription(offer);

    return pc;

}

////////////////////////////////////////////////////
////////////// MAX BITRATE /////////////////////////
////////////////////////////////////////////////////

async function config_max(stream, max, codec) {
    let pc = new RTCPeerConnection();

    let send_encodings = [ { maxBitrate: max } ];

	let transceiver = pc.addTransceiver(stream.getVideoTracks()[0], {
		direction: 'sendonly',
		sendEncodings: send_encodings
	});

    if(codec) set_codec_preferences(transceiver, codec);
    const offer = await pc.createOffer();

	await pc.setLocalDescription(offer);

    return pc;
}

////////////////////////////////////////////////////
////////////// SIMULCAST ///////////////////////////
////////////////////////////////////////////////////

async function config_simulcast(stream, codec) {
    let pc = new RTCPeerConnection();

    let send_encodings = [
		{rid: 'l', scaleResolutionDownBy: 4.0, scalabilityMode: 'L1T1', maxBitrate: 800*1000 },
		{rid: 'm', scaleResolutionDownBy: 2.0, scalabilityMode: 'L1T1', minBitrate: 700*1000, maxBitrate: 2000*1000 },
		{rid: 'h', scalabilityMode: 'L1T1', minBitrate: 1800*1000, maxBitrate: 2500*1000 }
	];

    let transceiver = pc.addTransceiver(stream.getVideoTracks()[0], {
		direction: 'sendonly',
		sendEncodings: send_encodings
	});

    if(codec) set_codec_preferences(transceiver, codec);
    const offer = await pc.createOffer();

	console.log(offer);

	await pc.setLocalDescription(offer);

    return pc;
}