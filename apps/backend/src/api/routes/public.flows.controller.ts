import { Controller, Get, Header } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { FlowsService } from '@gitroom/nestjs-libraries/flows/flows.service';

// The flow catalog for the public /pricing page. No login: it holds only the
// catalog fields FlowsService passes on (title, summary, cost, ...), the same
// for every visitor, and is cached for a minute.
@ApiTags('Public')
@Controller('/public/flows')
export class PublicFlowsController {
  constructor(private _flows: FlowsService) {}

  @Get('/')
  @Header('Cache-Control', 'public, max-age=60')
  flows() {
    return this._flows.list();
  }
}
