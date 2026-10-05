import { Controller, Get, Header } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import openApi from '../../../../public-api.openapi.json';

// The OpenAPI description of /public/v1, for docs and agents. Public: it
// describes the API and holds nothing about any workspace, so it sits outside
// PublicAuthMiddleware and allows any origin.
@ApiExcludeController()
@Controller('/public/v1')
export class PublicOpenApiController {
  @Get('/openapi.json')
  @Header('Access-Control-Allow-Origin', '*')
  @Header('Cache-Control', 'public, max-age=300')
  spec() {
    return openApi;
  }
}
