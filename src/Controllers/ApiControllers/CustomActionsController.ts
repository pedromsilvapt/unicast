import { BaseController, Route, ValidateBody, ValidateQuery } from "../BaseController";
import { Response, Request } from "restify";
import { ResourceNotFoundError } from "restify-errors";
import { CustomActionButton, CustomActionResult } from '../../CustomActions/CustomAction';
import { CustomActionContext } from '../../CustomActions/CustomActionContext';

export class CustomActionsController extends BaseController {
    @ValidateQuery( `{}` )
    @Route( 'get', '/' )
    async list ( req : Request, res : Response ) {
        // Get all custom actions in the order they were registered in the config file
        const customActionsList = Array.from( this.server.customActions );

        const customActionGroups: CustomActionGroup[] = [];
        
        for ( const action of customActionsList ) {
            // Get the button object from the action
            const button = action.getButton();

            // Try to find a matching group in the list of groups
            let group = customActionGroups.find( group => group.name == button.group );

            // If no group is found (this is the first button we've encountered for such group)
            // then create the group and append it to the bottom of the groups' list
            if ( group == null ) {
                group = {
                    name: button.group,
                    actions: []
                };

                customActionGroups.push( group );
            }

            // Finally append this button to its group
            group.actions.push( button );
        }

        return customActionGroups;
    }

    @ValidateBody( `{
        context?: object;
    }` )
    @Route( 'post', '/execute/:name' )
    async execute ( req : Request, res : Response ): Promise<CustomActionResult> {
        const name: string = req.params.name;
        
        const action = this.server.customActions.get( name );

        if ( action == null ) {
            throw new ResourceNotFoundError(`Action named ${name}`);
        }

        const context: CustomActionContext = req.body.context;

        try {
            return action.execute( context, req.body );
        } catch ( err ) {
            this.logger.error( err.message + err.stack );

            return { kind: 'error', message: err.message };
        }
    }
}

export interface CustomActionGroup {
    name: string;
    actions: CustomActionButton[];
}
