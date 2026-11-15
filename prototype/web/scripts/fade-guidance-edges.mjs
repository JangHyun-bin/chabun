import {readFile,writeFile,rename} from 'node:fs/promises'
import {join,resolve} from 'node:path'
import {fileURLToPath} from 'node:url'
import {execFileSync} from 'node:child_process'
import {createHash} from 'node:crypto'

// A clip whose first or last millisecond is above the noise floor steps from silence straight into signal and plays as a click.
// Those clips get a 5 ms raised-cosine fade at both edges and one re-encode in the original format; the rest stay byte-identical.
export const edgeFade={fadeMs:5,edgeMs:1,boundarySamples:4,thresholdDb:-60,rate:44100,encoder:'libmp3lame 192 kbps CBR, 44.1 kHz mono'}
const root=fileURLToPath(new URL('../',import.meta.url))
const hash=value=>createHash('sha256').update(value).digest('hex')
function decode(file){
 const raw=execFileSync('ffmpeg',['-v','error','-i',file,'-ac','1','-ar',String(edgeFade.rate),'-f','f32le','-'],{maxBuffer:1<<28})
 return new Float32Array(raw.buffer.slice(raw.byteOffset,raw.byteOffset+raw.length))
}
const peakDb=part=>Math.round(20*Math.log10(Math.max(1e-9,...Array.from(part,Math.abs)))*10)/10
// Peak level of the first and last `count` samples.
export function edgePeaksDb(samples,count=Math.round(edgeFade.rate*edgeFade.edgeMs/1000)){
 return {start:peakDb(samples.subarray(0,count)),end:peakDb(samples.subarray(samples.length-count))}
}
async function main(){
 const apply=process.argv.includes('--apply'),file=join(root,'src/audio/assets.json')
 const assets=JSON.parse(await readFile(file,'utf8')),report=[]
 for(const [index,asset]of assets.entries()){
  const source=join(root,'public',asset.path),samples=decode(source),before=edgePeaksDb(samples)
  // A faded clip keeps a smooth tail inside its first and last millisecond, so it is never selected or re-encoded again.
  if(asset.postProcess||Math.max(before.start,before.end)<=edgeFade.thresholdDb)continue
  if(!apply){report.push({file:asset.file,before});continue}
  const fade=Math.round(edgeFade.rate*edgeFade.fadeMs/1000)
  // bitexact keeps encoder version strings out of the bytes, so the same FFmpeg/LAME build reproduces the same file.
  execFileSync('ffmpeg',['-v','error','-y','-i',source,'-af',`afade=t=in:ns=${fade}:curve=hsin,afade=t=out:ss=${samples.length-fade}:ns=${fade}:curve=hsin`,
   '-c:a','libmp3lame','-b:a','192k','-ar',String(edgeFade.rate),'-ac','1','-map_metadata','-1','-fflags','+bitexact','-flags:a','+bitexact','-f','mp3',source+'.tmp'])
  const faded=decode(source+'.tmp'),boundary=edgePeaksDb(faded,edgeFade.boundarySamples)
  if(faded.length!==samples.length||Math.max(boundary.start,boundary.end)>edgeFade.thresholdDb)throw new Error(`Edge fade left a step: ${asset.file} ${JSON.stringify({samples:[samples.length,faded.length],boundary})}`)
  await rename(source+'.tmp',source)
  const bytes=await readFile(source),duration=Number(execFileSync('ffprobe',['-v','error','-show_entries','format=duration','-of','default=nw=1:nk=1',source],{encoding:'utf8'}).trim())
  assets[index]={...asset,duration,bytes:bytes.length,audioHash:hash(bytes),postProcess:{edgeFadeMs:edgeFade.fadeMs,reason:`first or last ${edgeFade.edgeMs} ms peaked above ${edgeFade.thresholdDb} dBFS (${before.start} / ${before.end})`,encoder:edgeFade.encoder,sourceAudioHash:asset.audioHash,sourceBytes:asset.bytes}}
  await writeFile(source.replace(/\.mp3$/,'.json'),JSON.stringify(assets[index],null,2)+'\n')
  report.push({file:asset.file,before,after:edgePeaksDb(faded),boundary:{before:edgePeaksDb(samples,edgeFade.boundarySamples),after:boundary},bytes:bytes.length,duration})
 }
 if(apply)await writeFile(file,JSON.stringify(assets,null,2)+'\n')
 console.log(JSON.stringify({apply,rule:edgeFade,clips:report},null,2))
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))await main()
