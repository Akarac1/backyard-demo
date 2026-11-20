# ตัวกลางป้ายทะเบียน → NVR

ทำงานบนคอมที่อยู่ LAN เดียวกับ NVR ดึงรายการป้ายที่ควรมีจากเว็บ แล้วเพิ่ม/แก้/ลบแถวใน NVR ให้เอง
แตะเฉพาะแถวที่ Owner ขึ้นต้น `BY-` แถวที่ทีมใส่เองจะไม่ถูกแก้หรือลบ

## ติดตั้ง (Mac)
1. ติดตั้ง Node 20+: https://nodejs.org (หรือ `brew install node`) ตรวจด้วย `node -v`
2. คัดลอกโฟลเดอร์ `bridge` ไปไว้ที่ `~/backyard-bridge`
3. `cd ~/backyard-bridge && cp .env.example .env` แล้วเปิด `.env` กรอกค่า (รหัส NVR กรอกในไฟล์นี้เท่านั้น)
4. ทดสอบอ่านอย่างเดียว: `node bridge.mjs probe`
5. ดูว่าจะเปลี่ยนอะไร (ยังไม่เปลี่ยนจริง): `node bridge.mjs once`
6. ลองทำจริงรอบเดียว: `node bridge.mjs once --apply` แล้วเช็กใน NVR
7. ให้ทำงานตลอด: `node bridge.mjs run --apply`

## ให้เปิดเองเมื่อเครื่องรีสตาร์ท
- Mac: สร้าง launchd (Claude จะให้ไฟล์ plist ตอนพร้อมใช้งานจริง)
- Windows: `schtasks /create /tn BackyardBridge /sc onstart /ru SYSTEM /tr "cmd /c cd /d C:\backyard-bridge && node bridge.mjs run --apply >> bridge.log 2>&1"`

## ความปลอดภัย
- `MAX_CHANGES` / `MAX_DELETES` ใน `.env` กันการเปลี่ยนทีละมากผิดปกติ (เช่นรายการจากเว็บว่างเพราะระบบขัดข้อง)
- ไม่เปิดพอร์ตเข้าลาน ตัวกลางเรียกออกไปหาเว็บเท่านั้น
- ชื่อรายการและคำสั่ง NVR (`TrafficRedList`, recordUpdater) เป็นค่าที่ต้องยืนยันด้วย `probe` ก่อนใช้ `--apply`
