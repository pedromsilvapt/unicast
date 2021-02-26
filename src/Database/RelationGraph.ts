import type { Relation } from './Relations/Relation';

export interface DotNode {
    name: string;
    children: DotNode[];
}

export function expandDotStrings ( strings : string[] ) : DotNode[] {
    const root : DotNode = { name: '<root>', children: [] };

    for ( let string of strings ) {
        const segments = string.split( '.' );

        let cursor = root;

        for ( let i = 0; i < segments.length; i++ ) {
            let childIndex = cursor.children.findIndex( node => node.name == segments[ i ] );

            if ( childIndex >= 0 ) {
                cursor = cursor.children[ childIndex ];
            } else {
                cursor.children.push( { name: segments[ i ], children: [] } );

                cursor = cursor.children[ cursor.children.length - 1 ];
            }
        }
    }

    return root.children;
}


export interface Relatable<R> {
    relations : Record<string, Relation<R, any>>;

    tableChainDeep ( children: DotNode[] ) : Relation<any, any>[];
}

export function tableChainDeep<R> ( relatable : Relatable<R>, children: DotNode[] ) : Relation<R, any>[] {
    return children.map( rel => {
        if ( rel.name in relatable.relations ) {
            const relatedTable = relatable.relations[ rel.name ].relatedTable;

            if ( relatedTable != null ) {
                return relatable.relations[ rel.name ].with( ...relatedTable.tableChainDeep( rel.children ) );
            }
        }
        
        return null;
    } ).filter( rel => rel != null );
}
