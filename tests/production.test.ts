import { afterEach, describe, expect, it, vi } from 'vitest';
import { EventPlan, parsePlan, runRepair, originalAssignment, validateAssignment, importSessionsCsv, sessionsTemplateCsv } from '../src/domain';
import { demoPlan } from '../src/fixtures';
import { webhookEvent } from '../api/webhook';
import { publicAddress, signature } from '../api/webhook-worker';
import { handler } from '../api/handler';
function largePlan(): EventPlan {
  const p = demoPlan();
  p.rooms = Array.from({length:40}, (_,i)=>({id:`r${i}`,name:`Room ${i}`,capacity:100,equipment:[],accessible:true}));
  p.startSlots = Array.from({length:96}, (_,i)=>480+i*5); p.endMinute=1020;
  p.sessions = Array.from({length:200}, (_,i)=>({id:`s${i}`,title:`Session ${i}`,speakerId:`speaker${i}`,attendance:50,equipment:[],requiresAccessible:false,durationMinutes:i%2 ? 45:60,originalStartMinute:480+Math.floor(i/40)*60,originalRoomId:`r${i%40}`,earliestStartMinute:480,latestStartMinute:960}));
  p.outages=[];p.speakerUnavailability=[];p.selectedSessionId='s0';return p;
}
afterEach(()=>vi.unstubAllEnvs());
describe('larger event scheduling',()=>{
  it('checks and solves 200 variable-length sessions across 40 rooms',()=>{
    const p=largePlan(); expect(parsePlan(p).ok).toBe(true);
    const r=runRepair(p,{mode:'A'});
    expect(r.assignment).toBeDefined(); expect(r.report?.valid).toBe(true); expect(r.metrics?.changedSessions).toBe(0);
    expect(r.elapsedMs).toBeLessThan(5000);
  });
  it('repairs a disrupted large event without dropping sessions',()=>{
    const p=largePlan();p.outages=[{roomId:'r0',startMinute:480,endMinute:540}];
    const r=runRepair(p,{mode:'A'});
    expect(r.assignment).toBeDefined();expect(r.report?.valid).toBe(true);expect(Object.keys(r.assignment!)).toHaveLength(200);
  });
  it('detects overlaps for unequal session lengths',()=>{
    const p=largePlan();const a=originalAssignment(p);a.s40.startMinute=525;
    expect(validateAssignment(p,a).checks.find(c=>c.id==='room-conflict')?.passed).toBe(false);
  });
  it('round-trips durations through a session spreadsheet',()=>{
    const p=largePlan();const r=importSessionsCsv(sessionsTemplateCsv(p),p);
    expect(r.ok).toBe(true); if(r.ok)expect(r.plan.sessions.map(s=>s.durationMinutes)).toEqual(p.sessions.map(s=>s.durationMinutes));
  });
  it('rejects unsafe identifiers and impossible calendar dates',()=>{
    const p=demoPlan();p.sessions[0].id='__proto__';expect(parsePlan(p).ok).toBe(false);
    p.sessions[0].id='normal';p.localDate='2026-02-30';expect(parsePlan(p).ok).toBe(false);
  });
});
describe('webhook safety',()=>{
  it('rejects loopback, private, metadata and mapped private addresses',()=>{
    for(const address of ['127.0.0.1','10.1.2.3','192.168.1.1','169.254.169.254','::1','::ffff:127.0.0.1','fc00::1','0.0.0.0'])expect(publicAddress(address)).toBe(false);
    expect(publicAddress('8.8.8.8')).toBe(true);
  });
  it('signs the exact payload and timestamp',()=>{
    expect(signature('body','123','secret')).toHaveLength(64);
    expect(signature('body','123','secret')).not.toBe(signature('body2','123','secret'));
    expect(signature('body','123','secret')).not.toBe(signature('body','124','secret'));
  });
  it('uses stable event ids, scoped to the organizer',()=>{
    const p=demoPlan(),a=runRepair(p,{mode:'A'}).assignment!;
    expect(webhookEvent(p,a,'alice').id).toBe(webhookEvent(p,a,'alice').id);
    expect(webhookEvent(p,a,'alice').id).not.toBe(webhookEvent(p,a,'bob').id);
    expect(JSON.stringify(webhookEvent(p,a,'alice'))).not.toContain('speakerId');
  });
  it('requires cloud authentication and an access token with the correct scope',async()=>{
    vi.stubEnv('REQUIRE_AUTH','true');
    const request={requestContext:{http:{method:'POST',path:'/repair'}},body:JSON.stringify({plan:demoPlan(),objective:{mode:'A'}})};
    expect((await handler(request)).statusCode).toBe(401);
    expect((await handler({...request,requestContext:{...request.requestContext,authorizer:{jwt:{claims:{sub:'user',token_use:'id',scope:'planb/write'}}}}})).statusCode).toBe(401);
    expect((await handler({...request,requestContext:{...request.requestContext,authorizer:{jwt:{claims:{sub:'user',token_use:'access',scope:'planb/write'}}}}})).statusCode).toBe(200);
  });
  it('never queues an invalid schedule or publishes anonymously',async()=>{
    const p=demoPlan();const request={requestContext:{http:{method:'POST',path:'/publish'}},body:JSON.stringify({plan:p,assignment:originalAssignment(p)})};
    expect((await handler(request)).statusCode).toBe(401);
    expect((await handler({...request,requestContext:{...request.requestContext,authorizer:{jwt:{claims:{sub:'user',token_use:'access',scope:'planb/write'}}}}})).statusCode).toBe(422);
  });
});
