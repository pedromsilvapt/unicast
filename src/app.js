import Cluster from './Server/Cluster';

let cluster = new Cluster();

cluster.listen().then( status => {
	let type = cluster.isMaster ? 'Master' : 'Worker';

	console.log( type, 'Server listening on http://' + status.ip + ':' + status.port );
}, ( error ) => {
	console.error( 'ERROR', error.message, error.stack );
} );