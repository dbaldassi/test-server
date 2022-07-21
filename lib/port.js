
module.exports = function(request, protocol, endpoint) {
    const connection = request.accept(protocol);
    
    const port = endpoint.candidates[0].port;
    console.log(port);
    connection.sendUTF(JSON.stringify({ port: port }));
};
