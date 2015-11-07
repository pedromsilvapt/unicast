import Controller from './Controller';
import config from 'config';

export default class ReceiverController extends Controller {
	get receiver () {
		return this.server.receivers.get( config.get( 'devices.default' ).type, config.get( 'devices.default' ).name );
	}
}