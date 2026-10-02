import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const mocks=vi.hoisted(()=>({send:vi.fn(),lookup:vi.fn(),request:vi.fn()}));
vi.mock('@aws-sdk/client-secrets-manager',()=>({SecretsManagerClient:class{send=mocks.send},GetSecretValueCommand:class{constructor(public input:unknown){}}}));
vi.mock('node:dns/promises',()=>({lookup:mocks.lookup}));
vi.mock('node:https',()=>({request:mocks.request}));
import { deliver, handler, signature } from '../api/webhook-worker';
beforeEach(()=>{
  mocks.send.mockReset().mockResolvedValue({SecretString:JSON.stringify({signingSecret:'s'.repeat(48)})});
  mocks.lookup.mockReset().mockResolvedValue([{address:'8.8.8.8',family:4}]);
  mocks.request.mockReset().mockImplementation((_options,callback)=>{
    const req=new EventEmitter() as EventEmitter & {end:(body:string)=>void};
    req.end=()=>{const res=new EventEmitter() as EventEmitter & {statusCode:number;resume:()=>void};res.statusCode=204;res.resume=()=>{};callback(res);queueMicrotask(()=>res.emit('end'));};
    return req;
  });
  vi.stubEnv('WEBHOOK_URL','https://receiver.example/events');vi.stubEnv('WEBHOOK_SECRET_ARN','test-secret');
});
afterEach(()=>vi.unstubAllEnvs());
it('pins a public IP while preserving TLS hostname verification and signature',async()=>{
  const body='{"id":"event-one"}';await deliver(body,'https://receiver.example/events','secret');
  const opts=mocks.request.mock.calls[0][0];
  expect(opts.hostname).toBe('8.8.8.8');expect(opts.servername).toBe('receiver.example');expect(opts.path).toBe('/events');
  expect(opts.headers['X-PlanB-Signature']).toBe('v1='+signature(body,opts.headers['X-PlanB-Timestamp'],'secret'));
  expect(opts.rejectUnauthorized).not.toBe(false);
});
it('does not make a request to private DNS answers',async()=>{
  mocks.lookup.mockResolvedValue([{address:'10.0.0.1',family:4}]);
  await expect(deliver('{"id":"x"}','https://receiver.example/events','secret')).rejects.toThrow('public');expect(mocks.request).not.toHaveBeenCalled();
});
it('retries non-success responses and never follows redirects',async()=>{
  mocks.request.mockImplementation((_options,callback)=>{const req=new EventEmitter() as any;req.end=()=>{const res=new EventEmitter() as any;res.statusCode=302;res.resume=()=>{};callback(res);queueMicrotask(()=>res.emit('end'));};return req;});
  const r=await handler({Records:[{messageId:'retry-me',body:'{"id":"x"}'}]});
  expect(r.batchItemFailures).toEqual([{itemIdentifier:'retry-me'}]);expect(mocks.request).toHaveBeenCalledTimes(1);
});
it('acknowledges a successful delivery and retries missing secrets',async()=>{
  expect(await handler({Records:[{messageId:'ok',body:'{"id":"x"}'}]})).toEqual({batchItemFailures:[]});
  mocks.send.mockRejectedValue(new Error('unavailable'));
  expect(await handler({Records:[{messageId:'retry',body:'{"id":"x"}'}]})).toEqual({batchItemFailures:[{itemIdentifier:'retry'}]});
});
