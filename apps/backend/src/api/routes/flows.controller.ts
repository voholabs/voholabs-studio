import { Controller, Get } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { FlowsService } from '@gitroom/nestjs-libraries/flows/flows.service';

// The flows (packaged marketing jobs the user's agent runs), for the Flows
// page. Every signed-in workspace sees them.
@ApiTags('Flows')
@Controller('/flows')
export class FlowsController {
  constructor(private _flows: FlowsService) {}

  @Get('/')
  list() {
    return this._flows.list();
  }
}
