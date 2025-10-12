
const Cascade = require('./streamer.js');

module.exports = function(request, protocol, endpoint) {
    console.log("CASCADE PROTOCOLE : ", Cascade);
    
    const connection = request.accept(protocol);

    connection.sendUTF(JSON.stringify({ media_info: Cascade.media_info.plain() }));
};
