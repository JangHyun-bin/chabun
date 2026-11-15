import {test,expect} from '@playwright/test'

for(const colorScheme of ['light','dark'] as const){
  test(`current surroundings identifies the rear approach and refuge as demonstrations in ${colorScheme}`,async({page})=>{
    await page.emulateMedia({colorScheme,reducedMotion:'reduce'})
    await page.goto('/?study=surroundings&view=current')
    const scene=page.locator('.ss-scene')
    const approaching=scene.getByRole('img',{name:'뒤에서 접근 중',exact:true})
    const refuge=scene.getByRole('img',{name:'가드레일 밖 대피 지점 · 현장 안전 확인 필요',exact:true})
    await expect(approaching).toBeVisible()
    await expect(refuge).toBeVisible()
    await expect(scene.getByText('2차로',{exact:true})).toBeVisible()
    await expect(scene.getByText('3차로',{exact:true})).toBeVisible()
    await expect(page.locator('.ss-source')).toHaveText('현재')
    await expect(page.locator('.ss-current-footer')).toContainText('이동 전 현장 안전을 확인하세요.')
    await expect(page.locator('.ss-scene-key')).toContainText('우측 측면 충돌')
    await expect(page.getByRole('button',{name:'주변 움직임 재생',exact:true})).toBeVisible()
    const before=await approaching.locator('[data-scene-car]').getAttribute('transform')
    await page.waitForTimeout(150)
    expect(await approaching.locator('[data-scene-car]').getAttribute('transform')).toBe(before)
    const own=(await scene.locator('[data-scene-car="own"]').boundingBox())!
    const rear=(await approaching.locator('[data-scene-car]').boundingBox())!
    const guardrail=(await scene.locator('.ss-barrier').boundingBox())!
    const refugePoint=(await refuge.locator('circle').boundingBox())!
    expect(rear.y).toBeGreaterThan(own.y+own.height)
    expect(refugePoint.x).toBeGreaterThan(guardrail.x)
  })
}

test('replay keeps lane and right-side collision context without presenting current safety markers as recorded evidence',async({page})=>{
  await page.emulateMedia({reducedMotion:'reduce'})
  await page.goto('/?study=surroundings&view=current')
  await page.getByRole('button',{name:'사고 재생',exact:true}).click()
  const scene=page.locator('.ss-scene')
  await expect(page.locator('.ss-source')).toHaveText('기록 재생')
  await expect(scene.getByRole('img',{name:/대피 지점/})).toHaveCount(0)
  await expect(scene.getByRole('img',{name:/접근 중/})).toHaveCount(0)
  await expect(scene.getByText('2차로',{exact:true})).toBeVisible()
  await expect(scene.getByText('3차로',{exact:true})).toBeVisible()
  const own=(await scene.locator('[data-scene-car="own"]').boundingBox())!
  const other=(await scene.locator('[data-scene-car="other"]').boundingBox())!
  expect(other.x).toBeGreaterThan(own.x+own.width)
  await expect(page.getByRole('button',{name:'접촉 부위 자세히 보기',exact:true})).toHaveCount(0)
  await page.getByRole('button',{name:'충격 시점',exact:true}).click()
  await page.getByRole('button',{name:'접촉 부위 자세히 보기',exact:true}).click()
  await expect(page.getByRole('region',{name:'접촉 부위 설명'})).toContainText('우측 전방')
  await page.getByRole('button',{name:'현재로 돌아가기',exact:true}).click()
  await expect(scene.getByRole('img',{name:'뒤에서 접근 중',exact:true})).toBeVisible()
  await expect(scene.getByRole('img',{name:/대피 지점/})).toBeVisible()
})

test('a paused or disconnected demonstration never relabels its last positions as live observations',async({page})=>{
  await page.emulateMedia({reducedMotion:'reduce'})
  await page.goto('/?study=surroundings&view=current')
  await page.getByRole('button',{name:'신호 끊김 시연',exact:true}).click()
  await expect(page.locator('.ss-source')).toHaveText('신호 없음')
  await expect(page.locator('.ss-current-footer')).toContainText('마지막 위치를 유지해요.')
  await expect(page.locator('.ss-current-footer')).toContainText('가드레일 밖 대피 지점')
  await expect(page.getByRole('button',{name:'주변 움직임 재생',exact:true})).toBeDisabled()
  await expect(page.locator('.ss-scene').getByRole('img',{name:/대피 지점/})).toBeVisible()
})
