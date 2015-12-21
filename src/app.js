import Application from './Application';
import ServerCommand from './Commands/Server';
import ExtractCommand from './Commands/Extract';
import ConsoleCommand from './Commands/Console/Command';
import TranscodeCommand from './Commands/Transcode';

let app = new Application();

app.register( new ServerCommand() );
app.register( new ExtractCommand() );
app.register( new ConsoleCommand() );
app.register( new TranscodeCommand() );

app.parse();