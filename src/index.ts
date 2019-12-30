import { UnicastServer } from "./UnicastServer";
import { FFmpegDriverFactory } from "./Transcoding/FFmpegDriver/FFmpegDriver";
import { FFmpegHlsDriverFactory } from "./Transcoding/FFmpegHlsDriver/FFmpegHlsDriver";
import { UpdatePathsTool } from "./Tools/UpdatePaths";
import { SetArtworkTool } from "./Tools/SetArtwork";
import { SetAssociationTool } from './Tools/SetAssociation';
import { LoadArtworkTool } from "./Tools/LoadArtwork";
import { ExportDatabaseTool } from "./Tools/ExportDatabase";
import { ImportDatabaseTool } from './Tools/ImportDatabase';
import { RepairDatabaseTool } from './Tools/RepairDatabase';
import { AddCustomTool } from "./Tools/AddCustom";
import { PreviewTriggersTool } from './Tools/PreviewTriggers';
import { TestTool, ToolFactory } from "./Tools/Tool";
import { PersistSubtitlesTool } from './Tools/PersistSubtitles';
import { CollectionsSyncTool } from './Tools/CollectionsSync';
import { FullScanMediaCastTool } from './Tools/Migrations/FullScanMediaCast';
import { LocateTool } from './Tools/Locate';

if ( !Symbol.asyncIterator ) {
    (Symbol as any).asyncIterator = Symbol( "Symbol.asyncIterator" );
}

const server = new UnicastServer();

server.transcoding.registerDriver( new FFmpegDriverFactory() );
server.transcoding.registerDriver( new FFmpegHlsDriverFactory() );

server.tools.add( new ToolFactory( UpdatePathsTool ) );
server.tools.add( new ToolFactory( SetArtworkTool ) );
server.tools.add( new ToolFactory( SetAssociationTool ) );
server.tools.add( new ToolFactory( LoadArtworkTool ) );
server.tools.add( new ToolFactory( ExportDatabaseTool ) );
server.tools.add( new ToolFactory( ImportDatabaseTool ) );
server.tools.add( new ToolFactory( RepairDatabaseTool ) );
server.tools.add( new ToolFactory( AddCustomTool ) );
server.tools.add( new ToolFactory( PersistSubtitlesTool ) );
server.tools.add( new ToolFactory( PreviewTriggersTool ) );
server.tools.add( new ToolFactory( CollectionsSyncTool ) );
server.tools.add( new ToolFactory( FullScanMediaCastTool ) );
server.tools.add( new ToolFactory( LocateTool ) );
server.tools.add( new ToolFactory( TestTool ) );

server.run()
    .catch( err => console.error( err.message, err.stack ) )
    .then( () => process.exit() );
    

process.on( 'unhandledRejection', ( error : any ) => {
    console.error( error.message, error.stack );
} );

export { server };

export function close () {
    return server.close();
}
