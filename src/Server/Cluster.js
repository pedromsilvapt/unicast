import config from 'config';
import cluster from 'cluster';
import Server from './Server';
import MediaServer from './MediaServer';

// Controllers
import MasterController from './Controllers/MasterController';

export default class Cluster extends Server {
	constructor () {
		super();

		this.startCluster = true;

		this.workers = [];
	}

	get isMaster () {
		return cluster.isMaster && this.startCluster;
	}

	get isSlave () {
		return !this.isMaster;
	}

	fork () {
		let worker = cluster.fork();

		this.workers.push( worker );

		return worker;
	}

	async restart ( index = 0 ) {
		if ( index >= 0 && index < this.workers.length ) {
			this.workers[ index ].kill();
		}

		let worker = this.fork();

		return new Promise( ( resolve, reject ) => {
			worker.on( 'message', msg => {
				if ( msg && msg.cmd == 'listening' ) {
					resolve( msg.status );
				}
			} );

			worker.on( 'error', reject );
		} );
	}

	async initialize () {
		this.controller( MasterController );

		await super.initialize();

		this.fork();
	}

	listenWorker () {
		let mediaServer = new MediaServer();

		return mediaServer.listen().then( status => {
			process.send( { cmd: 'listening', status: status } );

			status.server = mediaServer;

			return status;
		} );
	}

	async listen ( port = null ) {
		if ( this.isMaster ) {
			if ( !port ) {
				port = config.get( 'server.master.port' );
			}

			return super.listen( port );
		} else {
			return this.listenWorker();
		}
	}
}