import {readFile,writeFile,mkdir} from 'node:fs/promises';
await mkdir('docs/submission',{recursive:true}); await mkdir('public/submission',{recursive:true});
const escape=s=>s.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;');
const nodes=[
 ['browser','Organizer', 'Guest: browser worker + local drafts',30,205,225,'#fff1bf'],
 ['hosting','AWS Amplify','Static React experience',310,110,240,'#eee7ff','Arch_AWS-Amplify_64'],
 ['auth','Amazon Cognito','Invited organizers · code + PKCE',640,110,250,'#eee7ff'],
 ['api','API Gateway','JWT + scope verification',310,275,240,'#ffffff','Arch_Amazon-API-Gateway_64'],
 ['planner','AWS Lambda','Repair + independent validation',640,275,250,'#ffffff','Arch_AWS-Lambda_64'],
 ['logs','CloudWatch','Logs + API error alarm',955,275,215,'#ffffff','Arch_Amazon-CloudWatch_64'],
 ['queue','SQS FIFO','Approved updates',45,505,185,'#fff5e9'],
 ['worker','Lambda delivery','HMAC-signed HTTPS',305,505,190,'#fff5e9'],
 ['secret','Secrets Manager','Signing key',565,505,180,'#fff5e9'],
 ['dlq','SQS dead-letter','Failed deliveries',815,505,180,'#fff5e9'],
];
const arrows=[['browser','hosting','Open workspace','M142 205 V165 H310'],['browser','api','Signed-in requests','M255 250 H280 V320 H310'],['browser','auth','Sign in','M142 205 V85 H765 V110'],['auth','api','Access token','M765 200 V235 H430 V275'],['api','planner','Plan / validate','M550 320 H640'],['planner','logs','Logs','M890 320 H955']];
let svg='<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="675" viewBox="0 0 1200 675"><defs><marker id="arrow" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto"><path d="M0 0L8 4L0 8" fill="#70657f"/></marker></defs><rect width="1200" height="675" fill="#fffcef"/><style>text{font-family:Arial,sans-serif;fill:#29263d}.name{font-size:17px;font-weight:700}.note{font-size:12px}.edge{font-size:12px;fill:#60536f}</style><text x="30" y="40" font-size="25" font-weight="700">PlanB Live · shipped AWS architecture</text><text x="30" y="63" font-size="13">Deterministic planning. Independent checks. Organizer approval.</text><rect x="285" y="95" width="900" height="305" rx="14" fill="#f8f5ff" stroke="#aa9fbc"/><text x="970" y="119" font-size="11" font-weight="700">DEPLOYED AWS SERVICES</text>';
for(const [,,label,path] of arrows) svg+=`<path d="${path}" fill="none" stroke="#70657f" stroke-width="1.8" marker-end="url(#arrow)"/>`;
svg+='<text x="163" y="153" class="edge">HTTPS</text><text x="454" y="81" class="edge">Sign in · code + PKCE</text><text x="579" y="224" class="edge">Access token</text><text x="567" y="311" class="edge">Invoke</text><text x="909" y="311" class="edge">Logs</text>';
svg+='<rect x="30" y="440" width="1140" height="185" rx="14" fill="#fff" stroke="#bdac96" stroke-dasharray="7 5"/><text x="48" y="468" font-size="15" font-weight="700">Optional delivery extension · disabled in the submitted live deployment</text><text x="48" y="488" font-size="12">Provisioned only when an authorized webhook recipient is configured. Approval alone never sends an update.</text>';
for(const [id,name,note,x,y,w,color,icon] of nodes){svg+=`<rect x="${x}" y="${y}" width="${w}" height="90" rx="12" fill="${color}" stroke="#92859f"/>`;if(icon){const data=Buffer.from(await readFile(`public/aws-icons/${icon}.svg`)).toString('base64');svg+=`<image href="data:image/svg+xml;base64,${data}" x="${x+12}" y="${y+15}" width="38" height="38"/>`;}svg+=`<text x="${x+(icon?62:14)}" y="${y+35}" class="name">${escape(name)}</text><text x="${x+14}" y="${y+69}" class="note">${escape(note)}</text>`;}
svg+='<g stroke="#a68c73" fill="none" marker-end="url(#arrow)" stroke-dasharray="5 4"><path d="M230 550H305"/><path d="M565 550H495"/><path d="M137 595V610H905V595"/><path d="M400 595V620H1085V565"/></g><text x="1030" y="535" font-size="13" font-weight="700">Connected service</text><text x="1030" y="556" font-size="12">External recipient</text><text x="30" y="653" font-size="12">Guest planning is public. Cloud planning requires sign-in. No cloud event database; event drafts remain in the browser.</text></svg>';
await writeFile('docs/submission/architecture.svg',svg);await writeFile('public/submission/architecture.svg',svg);
let xml='<mxfile host="app.diagrams.net"><diagram name="PlanB shipped architecture"><mxGraphModel page="1" pageWidth="1200" pageHeight="675"><root><mxCell id="0"/><mxCell id="1" parent="0"/>';
for(const [id,name,note,x,y,w,color] of nodes)xml+=`<mxCell id="${id}" value="${escape(name+'\n'+note)}" style="rounded=1;whiteSpace=wrap;fillColor=${color};strokeColor=#92859f;fontSize=14;" vertex="1" parent="1"><mxGeometry x="${x}" y="${y}" width="${w}" height="90" as="geometry"/></mxCell>`;
xml+='<mxCell id="recipient" value="Connected service&#10;External recipient" style="rounded=1;whiteSpace=wrap;fillColor=#fff1bf;fontSize=13;" vertex="1" parent="1"><mxGeometry x="1030" y="505" width="140" height="90" as="geometry"/></mxCell>';
for(const [i,[source,target,label]] of arrows.entries())xml+=`<mxCell id="edge${i}" value="${escape(label)}" style="edgeStyle=orthogonalEdgeStyle;endArrow=block;fontSize=12;" edge="1" parent="1" source="${source}" target="${target}"><mxGeometry relative="1" as="geometry"/></mxCell>`;
for(const [i,[source,target,label]] of [['queue','worker','Deliver'],['secret','worker','Read signing key'],['queue','dlq','Retries exhausted'],['worker','recipient','Signed HTTPS']].entries())xml+=`<mxCell id="optionalEdge${i}" value="${label}" style="edgeStyle=orthogonalEdgeStyle;endArrow=block;dashed=1;fontSize=11;" edge="1" parent="1" source="${source}" target="${target}"><mxGeometry relative="1" as="geometry"/></mxCell>`;
xml+='<mxCell id="optional" value="Optional delivery extension — DISABLED in live deployment. Configure an authorized recipient before enabling SQS, delivery Lambda, Secrets Manager and dead-letter queue." style="rounded=1;dashed=1;whiteSpace=wrap;fillColor=none;fontSize=13;" vertex="1" parent="1"><mxGeometry x="30" y="430" width="1140" height="65" as="geometry"/></mxCell></root></mxGraphModel></diagram></mxfile>';
await writeFile('docs/submission/architecture.drawio',xml);await writeFile('public/planb-architecture.drawio',xml);


