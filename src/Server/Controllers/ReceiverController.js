import Controller from './Controller';
import config from 'config';

export default class ReceiverController extends Controller {
	get receiver () {
		return this.server.receivers.get( this.params.receiver );
	}
}