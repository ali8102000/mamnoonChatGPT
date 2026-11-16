import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { inflateSync } from "node:zlib";

const args = new Map();
for (let i = 2; i < process.argv.length; i++) {
  const key = process.argv[i];
  if (key.startsWith("--")) args.set(key, process.argv[++i] ?? "true");
}
const webDir = args.get("--web-dir"), androidDir = args.get("--android-dir");
if (!webDir || !androidDir) {
  console.error("Usage: node scripts/compare-screen-captures.mjs --web-dir <dir> --android-dir <dir> [--max-diff-ratio 0.01] [--channel-tolerance 12]");
  process.exit(2);
}
const maxRatio = Number(args.get("--max-diff-ratio") ?? 0.01);
const tolerance = Number(args.get("--channel-tolerance") ?? 12);
const manifest = JSON.parse(readFileSync(resolve("parity/screen-parity-manifest.json"), "utf8"));
const visualScreens = [...manifest.screenPairs, ...manifest.adminSections];
const capturePairs = visualScreens.flatMap((screen) => (screen.contexts ?? ["customer"]).flatMap((context) => manifest.capture.theme.map((theme) => ({ id: screen.id, context, theme, filename: screen.id + "__" + context + "__" + theme + ".png" }))));
function decodePng(path) {
  const bytes = readFileSync(path);
  if (!bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) throw new Error(path + " is not a PNG");
  let offset=8,width=0,height=0,bitDepth=0,colorType=0,interlace=0;
  const idat=[];
  while(offset<bytes.length){
    const length=bytes.readUInt32BE(offset);offset+=4;
    const type=bytes.toString("ascii",offset,offset+4);offset+=4;
    const data=bytes.subarray(offset,offset+length);offset+=length+4;
    if(type==="IHDR"){width=data.readUInt32BE(0);height=data.readUInt32BE(4);bitDepth=data[8];colorType=data[9];interlace=data[12];}
    if(type==="IDAT")idat.push(data);
    if(type==="IEND")break;
  }
  if(bitDepth!==8||![2,6].includes(colorType)||interlace!==0)throw new Error(path+" must be a non-interlaced 8-bit RGB/RGBA PNG");
  const channels=colorType===6?4:3,bpp=channels,stride=width*channels,raw=inflateSync(Buffer.concat(idat));
  const pixels=Buffer.alloc(height*stride);let src=0;
  const paeth=(a,b,c)=>{const p=a+b-c,pa=Math.abs(p-a),pb=Math.abs(p-b),pc=Math.abs(p-c);return pa<=pb&&pa<=pc?a:pb<=pc?b:c;};
  for(let y=0;y<height;y++){
    const filter=raw[src++],row=y*stride,prev=row-stride;
    for(let x=0;x<stride;x++){
      const value=raw[src++],left=x>=bpp?pixels[row+x-bpp]:0,up=y>0?pixels[prev+x]:0,ul=y>0&&x>=bpp?pixels[prev+x-bpp]:0;
      let predictor=0;
      if(filter===1)predictor=left;else if(filter===2)predictor=up;else if(filter===3)predictor=Math.floor((left+up)/2);else if(filter===4)predictor=paeth(left,up,ul);else if(filter!==0)throw new Error(path+" unsupported PNG filter "+filter);
      pixels[row+x]=(value+predictor)&255;
    }
  }
  return {width,height,channels,pixels};
}
function compare(webPath,androidPath){
  const a=decodePng(webPath),b=decodePng(androidPath);
  if(a.width!==b.width||a.height!==b.height)return{pass:false,error:"Different dimensions",web:[a.width,a.height],android:[b.width,b.height]};
  let different=0,total=a.width*a.height,absolute=0;
  for(let p=0;p<total;p++){
    let pixelDifferent=false;
    for(let c=0;c<3;c++){const av=a.pixels[p*a.channels+c],bv=b.pixels[p*b.channels+c],d=Math.abs(av-bv);absolute+=d;if(d>tolerance)pixelDifferent=true;}
    if(pixelDifferent)different++;
  }
  const ratio=different/total;
  return{pass:ratio<=maxRatio,width:a.width,height:a.height,differentPixels:different,totalPixels:total,differentRatio:Number(ratio.toFixed(6)),meanChannelDifference:Number((absolute/(total*3)).toFixed(3)),threshold:maxRatio,tolerance};
}
const results=[];
for(const capture of capturePairs){
  try{results.push({...capture,...compare(resolve(webDir,capture.filename),resolve(androidDir,capture.filename))});}
  catch(error){results.push({...capture,pass:false,error:String(error)});}
}
const failures=results.filter((x)=>!x.pass);
const report={status:failures.length?"FAIL":"PASS",screens:results.length,visualScreens:visualScreens.length,contexts:[...new Set(capturePairs.map((x)=>x.context))],themes:manifest.capture.theme,passed:results.length-failures.length,failed:failures.length,maxDiffRatio:maxRatio,channelTolerance:tolerance,results};
console.log(JSON.stringify(report,null,2));
if(failures.length)process.exitCode=1;
