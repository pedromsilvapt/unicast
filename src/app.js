import Application from './Application';
import ServerCommand from './Commands/Server';

let app = new Application();

app.register( new ServerCommand() );

app.parse();