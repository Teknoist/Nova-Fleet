# Nova Fleet

Nova Fleet, birden fazla Nova3D reçine yazıcıyı aynı Windows uygulamasından izlemek ve yönetmek için geliştirilmiş modern bir masaüstü uygulamasıdır.

![Platform](https://img.shields.io/badge/platform-Windows-1f6feb)
![Electron](https://img.shields.io/badge/Electron-43-9feaf9)
![License](https://img.shields.io/badge/license-MIT-a9f4c7)

## Yeni bilgisayara kurulum

Normal kullanım için Node.js, Java veya başka bir geliştirme aracı kurmanız gerekmez.

1. GitHub deposundaki **Releases** sayfasını açın.
2. En güncel sürümden `Nova-Fleet-Setup-x.x.x.exe` dosyasını indirin.
3. İndirilen kurulum dosyasını çalıştırın.
4. Kurulum klasörünü seçip kurulumu tamamlayın.
5. Masaüstündeki **Nova Fleet** kısayolunu açın.

Uygulama henüz ticari kod imzalama sertifikasıyla imzalanmadığı için Windows SmartScreen uyarı gösterebilir. Dosyayı yalnızca bu deponun Releases sayfasından indirdiyseniz **Daha fazla bilgi → Yine de çalıştır** yolunu kullanabilirsiniz.

### Yazıcıları ekleme

1. Bilgisayar ve yazıcıların aynı yerel ağda olduğundan emin olun.
2. Nova Fleet içinde **Yazıcı ekle** düğmesine basın.
3. Yazıcının adını ve yerel IP adresini girin.
4. Portu, yazıcıda özel olarak değiştirilmediyse `8081` bırakın.
5. Sorgulama aralığını eski firmware için en az `10 saniye` tutun.
6. Profili kaydedin ve durumun **Hazır** olmasını bekleyin.

İlk açılışta arayüzü göstermek için üç demo yazıcı bulunur. Sunucu adları `demo-1`, `demo-2` ve `demo-3` olan bu profilleri Yazıcılar ekranından silebilirsiniz.

## Temel özellikler

- Birden fazla Nova3D yazıcı için merkezi filo görünümü
- Çevrimiçi, yazdırıyor, duraklatıldı ve çevrimdışı durum takibi
- `.cws` yükleme, listeleme, silme ve yazdırma
- Katman, ilerleme, geçen süre ve tahmini kalan süre
- Duraklatma, sürdürme ve işi durdurma
- Yazıcı başına IP, port, model, konum ve sorgulama aralığı
- Sorunlu eski firmware sürümlerini koruyan sıralı HTTP istekleri
- İnternet veya bulut hesabı gerektirmeyen yerel çalışma

## Sorun giderme

### Yazıcı çevrimdışı görünüyor

- Bilgisayar ile yazıcının aynı ağ/VLAN üzerinde olduğunu kontrol edin.
- Tarayıcıdan `http://YAZICI_IP:8081/file/list` adresini açmayı deneyin.
- Windows Güvenlik Duvarı'nda Nova Fleet'e yerel ağ izni verin.
- Yazıcı IP adresinin DHCP nedeniyle değişmediğini kontrol edin.
- Firmware yoğun isteklerden sonra kilitlendiyse yazıcıyı yeniden başlatın.

### Dosya yüklenmiyor

- Dosyanın `.cws` biçiminde olduğundan emin olun.
- Yazıcıda yeterli boş alan olup olmadığını kontrol edin.
- Yükleme sırasında yazıcının ağ bağlantısını kesmeyin.
- Çok büyük dosyalarda işlemin tamamlanması birkaç dakika sürebilir.

### Ayarlar nerede tutuluyor?

Yazıcı profilleri yalnızca mevcut Windows kullanıcısında, Electron uygulama veri klasöründeki `printers.json` dosyasında tutulur. Parola veya bulut kimlik bilgisi kaydedilmez.

Uygulamayı kaldırmak profilleri otomatik olarak silmez. Tam temizlik için Windows'ta `%APPDATA%` ve `%LOCALAPPDATA%` altında **Nova Fleet** klasörünü kaldırabilirsiniz.

## Geliştirici kurulumu

Gereksinimler: Node.js 24 ve npm.

```powershell
git clone https://github.com/Teknoist/Nova-Fleet.git
cd Nova-Fleet
npm install
npm run dev
```

Kontroller ve üretim derlemesi:

```powershell
npm test
npm run build
```

Windows kurulum paketi:

```powershell
npm run package:win
```

Çıktı `release/Nova-Fleet-Setup-<sürüm>.exe` olarak oluşturulur.

## Otomatik GitHub Release

`.github/workflows/release.yml` iki şekilde Windows paketi üretir:

- GitHub Actions ekranından **Windows release → Run workflow** ile manuel derleme
- `v0.1.0` benzeri bir Git etiketi gönderildiğinde otomatik GitHub Release

Yeni sürüm yayınlama örneği:

```powershell
git tag v0.1.0
git push origin v0.1.0
```

## Nova3D protokolü

Uygulama yazıcının yerel HTTP servisindeki uçları kullanır:

- `GET /file/list`
- `POST /file/upload/{filename}`
- `GET /file/delete/{filename}`
- `GET /file/print/{filename}`
- `GET /job/list/`
- `GET /job/toggle/{jobId}`
- `GET /job/stop/{jobId}`

Bu davranış Nova3D Elfin firmware `3.5.0` esas alınarak uygulanmıştır. Farklı firmware sürümlerinde protokol değişebileceği için ilk gerçek baskıyı gözetim altında yapın.

## Güvenlik

Bu Nova3D firmware uçlarında kimlik doğrulama bulunmaz. Yazıcıları yalnızca güvenilen LAN/VLAN içinde kullanın ve `8081` portunu internete açmayın.

## Lisans

MIT — ayrıntılar için [LICENSE](LICENSE) dosyasına bakın.
