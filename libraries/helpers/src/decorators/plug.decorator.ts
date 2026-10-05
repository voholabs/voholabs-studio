import 'reflect-metadata';

export function Plug(params: {
  identifier: string;
  title: string;
  description: string;
  runEveryMilliseconds: number;
  totalRuns: number;
  disabled?: boolean;
  // The paid API actions the plug performs, for a workspace that pays for
  // the provider from its wallet: each is `<provider>.<action>` in the price
  // rows ('post' is priced by the link rule, post or post_link). A plug with
  // an action that has no price row does not run for such a workspace.
  walletActions?: string[];
  fields: {
    name: string;
    description: string;
    type: string;
    placeholder: string;
    validation?: RegExp;
  }[];
}) {
  return function (
    target: Object,
    propertyKey: string | symbol,
    descriptor: any
  ) {
    // Retrieve existing metadata or initialize an empty array
    const existingMetadata = Reflect.getMetadata('custom:plug', target) || [];

    // Add the metadata information for this method
    existingMetadata.push({ methodName: propertyKey, ...params });

    // Define metadata on the class prototype (so it can be retrieved from the class)
    Reflect.defineMetadata('custom:plug', existingMetadata, target);
  };
}
