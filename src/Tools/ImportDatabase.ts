import * as fs from 'mz/fs';
import { BaseTable } from "../Database/Database";
import * as path from 'path';
import { Tool, ToolOption, ToolValueType } from "./Tool";
import { Stopwatch } from '../BackgroundTask';
import * as filesize from 'filesize';
import { collect, groupingBy, first } from 'data-collectors';

interface ExportDatabaseOptions {
    folder : string;
    exclude ?: string[];
    include ?: string[];
    batchSize : number;
    dryRun : boolean;
    print : boolean;
    firstLines ?: number;
    lastLines ?: number;
}

export class ImportDatabaseTool extends Tool<ExportDatabaseOptions> {
    getParameters () {
        return [ 
            new ToolOption( 'Folder' ).setRequired( true ),
        ];
    }

    getOptions () {
        return [
            new ToolOption( 'Include' ).setVariadic( true ).setAllowedValues( this.tables.keys() ),
            new ToolOption( 'Exclude' ).setVariadic( true ).setAllowedValues( this.tables.keys() ),
            new ToolOption( 'Backup' ).setDefaultValue( true ).setType( ToolValueType.Boolean ),
            new ToolOption( 'BatchSize' ).setDefaultValue( 100 ).setType( ToolValueType.Number ),
            new ToolOption( 'DryRun' ).setDefaultValue( false ).setType( ToolValueType.Boolean ),
            new ToolOption( 'Print' ).setDefaultValue( false ).setType( ToolValueType.Boolean ),
            new ToolOption( 'LastLines' ).setType( ToolValueType.Number ),
            new ToolOption( 'FirstLines' ).setType( ToolValueType.Number )
        ];
    }

    get tables () : Map<string, BaseTable<any>> {
        const database = this.server.database.tables;

        const tableNames = Object.keys( database );

        const tables = tableNames.map( name => database[ name ] as BaseTable<any> );

        return collect( tables, groupingBy( table => table.tableName, first() ) );
    }

    async exportTable ( table : BaseTable<any>, file : string ) : Promise<number> {
        const stopwatch = new Stopwatch().resume();

        this.log( 'Exporting', table.tableName, 'to', file );

        const records = await table.find();

        await this.server.storage.ensureDir( path.dirname( file ) );

        const buffer = Buffer.from( JSON.stringify( records ) );

        await fs.writeFile( file, buffer );

        this.log( 'Exported', records.length, 'records', `(in ${ stopwatch.readHumanized() }, ${filesize( buffer.byteLength )})` );

        return buffer.byteLength;
    }

    async print ( table : string, line : any ) {
        this.log( `${ table }: ${ JSON.stringify( line ) }` )
    }

    async run ( options : ExportDatabaseOptions ) {
        let tables = Array.from( this.tables.keys() );

        if ( options.include ) {
            tables = tables.filter( name => options.include.includes( name ) );
        }

        if ( options.exclude ) {
            tables = tables.filter( name => !options.exclude.includes( name ) );
        }

        for ( let tableName of tables ) {
            const table = this.tables.get( tableName );

            const fileName = `table_${ tableName }.json`;

            const filePath = path.join( options.folder, fileName );

            if ( !await fs.exists( filePath ) ) {
                this.log( `File for table ${ tableName } was not found.` );

                continue;
            }

            let lines = JSON.parse( await fs.readFile( filePath, 'utf8' ) ) as any[];

            if ( 'lastLines' in options ) {
                lines = lines.slice( - options.lastLines );
            }

            if ( 'firstLines' in options ) {
                lines = lines.slice( 0, options.firstLines );
            }

            this.log( `Table ${ tableName }: ${ lines.length }` );
            this.log( table.dateFields );
            
            if ( !options.dryRun ) {
                await table.deleteAll();

                if ( options.batchSize > 1 ) {
                    let sum = 0;

                    for ( let chunks of chunk( lines, options.batchSize ) ) {
                        this.log( `Creating ${ sum + chunks.length }/${ lines.length }...` );
                        
                        for ( let field of table.dateFields ) {
                            for ( let row of chunks ) {
                                if ( field in row && row[ field ] != void 0 ) {
                                    row[ field ] = new Date( row[ field ] );
                                }
                            }
                        }
                        
                        if ( options.print ) {
                            for ( let line of chunks ) {
                                this.print( tableName, line );
                            }
                        }

                        await table.createMany( chunks );

                        sum += chunks.length;
                    }
                } else {
                    for ( let line of lines ) {
                        if ( options.print ) {
                            this.print( tableName, line );
                        }

                        await table.create( line );
                    }
                }
            } else if ( options.print ) {
                for ( let line of lines ) {
                    this.print( tableName, line );
                }
            }
        }
    }
}

function * chunk <T> ( items : Iterable<T>, chunkSize : number ) : Iterable<T[]> {
    let array : T[] = [];

    for ( let item of items ) {
        array.push( item );

        if ( array.length >= chunkSize ) {
            yield array;

            array = [];
        }
    }
    
    if ( array.length >= 0 ) {
        yield array;
    }
}