import {expect,type Page} from '@playwright/test'

export async function startEmergencyResponse(page:Page){
 await page.goto('/')
 await page.getByRole('button',{name:'이 상황으로 시작',exact:true}).click()
 await page.evaluate(()=>document.fonts.ready)
 await page.getByRole('button',{name:'다친 사람이 있어요',exact:true}).click()
 await expect(page.getByTestId('journey-flow')).toHaveAttribute('data-step','2')
 await expect(page.getByTestId('journey-flow')).toHaveAttribute('data-call','idle')
 const board=page.getByTestId('flow-board')
 await expect(board).toHaveAttribute('data-layout','emergency',{timeout:8000})
 await expect(board).toHaveAttribute('data-moving','false',{timeout:8000})
}
