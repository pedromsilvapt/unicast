import Server from './Server';
import ProvidersManager from './Providers/Manager';
import ReceiversManager from '../Receivers/Manager';
import config from 'config';
import { connect } from 'camo';
import { Logger } from './Logger';

// Controllers
import WatchController from './Controllers/WatchController';
import DeviceController from './Controllers/DeviceController';

// Providers
import YoutubeProvider from './Providers/Youtube/Provider';
import LocalProvider from './Providers/Local/Provider';

// Receivers
import ChromecastReceiver from '../Receivers/Chromecast/Receiver';

export default class MediaServer extends Server {
	constructor () {
		super();

		this.providers = new ProvidersManager();
		this.receivers = new ReceiversManager();
	}

	components () {
		this.controller( WatchController );
		this.controller( DeviceController );

		this.providers.defaultProvider = 'local';
		this.providers.register( new YoutubeProvider() );
		this.providers.register( new LocalProvider() );

		this.receivers.register( ChromecastReceiver );
	}

	async initialize () {
		this.app.on( 'error', Logger.koaError() );

		this.use( Logger.koa() );

		this.components();

		return super.initialize();
	}

	async listen ( port = null ) {
		if ( !port ) {
			port = config.get( 'server.worker.port' );
		}

		this.database = await connect( 'nedb://storage/database' );

		return super.listen( port );
	}
}