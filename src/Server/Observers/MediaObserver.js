import Observer from './Observer';

export default class MediaObserver extends Observer {
	constructor () {
		super( [ 'started', 'paused', 'resumed', 'stopped' ] );
	}
}