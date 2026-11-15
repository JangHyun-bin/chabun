import {test,expect} from '@playwright/test'


test('status remains readable at narrow widths and with enlarged text',async({page})=>{
  await page.goto('/?study=surroundings')
  const bar=page.getByRole('region',{name:'차량 상태 표시'})
  for(const [width,font] of [[1600,16],[1100,16],[393,16],[360,16],[1600,32],[393,32],[360,32]]){
    await page.setViewportSize({width,height:1050})
    await page.evaluate(size=>{document.documentElement.style.fontSize=size+'px'},font)
    await expect(bar).toContainText('오후 9:12')
    await expect(bar).toContainText('차분 · 사고 대응 모드')
    await expect(bar).toContainText('5G   18°C')
    await expect.poll(()=>bar.evaluate(node=>{
      const b=node.getBoundingClientRect(),rects=[...node.children].map(n=>n.getBoundingClientRect())
      return {clipped:node.scrollWidth>node.clientWidth+1,inside:rects.every(r=>r.left>=b.left&&r.right<=b.right&&r.top>=b.top&&r.bottom<=b.bottom),overlap:rects.some((a,i)=>rects.slice(i+1).some(c=>a.left<c.right&&c.left<a.right&&a.top<c.bottom&&c.top<a.bottom))}
    }),{message:`Status at ${width}px / ${font}px`}).toEqual({clipped:false,inside:true,overlap:false})
  }
})

test('the shared status appears on each simulated vehicle route without browser errors',async({page})=>{
  const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message))
  for(const study of ['emergency','vehicle','surroundings']){
    await page.goto('/?study='+study)
    const bar=page.getByRole('region',{name:'차량 상태 표시'})
    await expect(bar).toBeVisible()
    await expect(bar.getByText('차분 · 사고 대응 모드',{exact:true})).toBeVisible()
  }
  expect(errors).toEqual([])
})
