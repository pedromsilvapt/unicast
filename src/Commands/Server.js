import Command from './Command';
import Cluster from '../Server/Cluster';
import logger from '../Server/Logger';

export default class Server extends Command {
	constructor () {
		super();

		this.name = 'server';
		this.description = 'Starts the server';
	}

	execute () {
		let cluster = new Cluster();

		logger.addTag( { msg: cluster.isMaster ? 'Master' : 'Worker', colors: 'red' } );

		cluster.listen().then( status => {
			logger.message( 'Server listening on http://' + status.ip + ':' + status.port );
		} ).catch( ( error ) => {
			console.error( 'ERROR', error.message, error.stack );
		} );
	}
}