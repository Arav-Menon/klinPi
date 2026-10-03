import type { AgentTool } from "../../types.js";

const create_issue: AgentTool = { 
    name : "create_issue",
    requiresSandbox : true,
    description: "create an issue into the users repo",

    parameters : {
        type: "object",
        properties: {
            url : {
                type: "string",
            description: ""
            }
        }
    }

}
