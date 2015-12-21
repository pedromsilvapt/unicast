import Server from './Server';
import StayAwake from './Utilities/StayAwake/Command';
import Deconstructor from './Utilities/Deconstructor';
import ProvidersManager from './Providers/Manager';
import ReceiversManager from '../Receivers/Manager';
import SendersManager from './SendersManager';
import MediaManager from '../MediaManager';
import config from 'config';
import { connect } from 'camo';
import Logger from './Logger';

// Controllers
import DeviceController from './Controllers/DeviceController';

// Providers
import YoutubeProvider from './Providers/Youtube/Provider';
import LocalProvider from './Providers/Local/Provider';

// Receivers
import ChromecastReceiver from '../Receivers/Chromecast/Receiver';

export default class MediaServer extends Server {
	constructor () {
		super();

		this.stayAwake = new StayAwake();
		this.deconstructor = new Deconstructor( () => this.stayAwake.sleep( true ) );

		this.providers = new ProvidersManager();
		this.receivers = new ReceiversManager();
		this.senders = new SendersManager( this, this.makeRouter.bind( this ) );
		this.media = new MediaManager( this );
	}

	sender ( receiver ) {
		return this.senders.get( receiver );
	}

	components () {
		this.controller( DeviceController );

		this.providers.defaultProvider = 'local';
		this.providers.register( new YoutubeProvider() );
		this.providers.register( new LocalProvider() );

		this.receivers.register( ChromecastReceiver );
	}

	async initialize () {
		this.database = await connect( 'nedb://storage/database' );

		this.app.on( 'error', Logger.koaError() );

		this.use( Logger.koa() );

		this.components();

		return super.initialize();
	}

	async listen ( port = null ) {
		if ( !port ) {
			port = config.get( 'server.worker.port' );
		}

		await this.stayAwake.awake();

		return super.listen( port );
	}
}