import Observer from './Observer';

export default class DeviceObserver extends Observer {
	constructor () {
		super( [ 'started', 'changed', 'paused', 'resumed', 'stopped', 'connected', '' ] );
	}
}