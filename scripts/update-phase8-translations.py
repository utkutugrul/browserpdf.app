#!/usr/bin/env python3
"""Apply the idempotent Phase 8 offline-shell copy migration to all locales."""

import argparse
import json
from pathlib import Path

PATH = Path(__file__).resolve().parents[1] / "public" / "translations.json"

# title, bounded capability, persist action, remove action, update action,
# storage unavailable, persistence denied, storage action failed
CORE = {
 "es": ("Ajustes del modo sin conexión", "Solo se guardan una pequeña interfaz estática y una página de conexión. Las herramientas y bibliotecas externas no funcionan sin conexión.", "Pedir al navegador que conserve la interfaz", "Eliminar datos sin conexión", "Activar actualización disponible", "Estimación de almacenamiento no disponible.", "El navegador no concedió almacenamiento persistente.", "El navegador no pudo completar la solicitud de almacenamiento."),
 "fr": ("Réglages du mode hors connexion", "Seuls une petite interface statique et un écran de connexion sont mis en cache. Les outils et bibliothèques externes ne fonctionnent pas hors connexion.", "Demander au navigateur de conserver l’interface", "Supprimer les données hors connexion", "Activer la mise à jour disponible", "Estimation du stockage indisponible.", "Le navigateur n’a pas accordé le stockage persistant.", "Le navigateur n’a pas pu traiter la demande de stockage."),
 "de": ("Offline-Shell-Einstellungen", "Nur eine kleine statische Oberfläche und eine Verbindungsseite werden gespeichert. Werkzeuge und externe Bibliotheken sind offline nicht aktiviert.", "Browser um dauerhafte Speicherung bitten", "Offline-Daten entfernen", "Verfügbares Update aktivieren", "Speicherschätzung nicht verfügbar.", "Der Browser hat keinen dauerhaften Speicher gewährt.", "Der Browser konnte die Speicheranfrage nicht abschließen."),
 "pt": ("Configurações do modo offline", "Apenas uma pequena interface estática e uma página de conexão ficam em cache. Ferramentas e bibliotecas externas não funcionam offline.", "Pedir ao navegador para manter a interface", "Remover dados offline", "Ativar atualização disponível", "Estimativa de armazenamento indisponível.", "O navegador não concedeu armazenamento persistente.", "O navegador não concluiu a solicitação de armazenamento."),
 "it": ("Impostazioni della modalità offline", "Vengono memorizzati solo una piccola interfaccia statica e una pagina di connessione. Strumenti e librerie esterne non sono attivi offline.", "Chiedi al browser di conservare l’interfaccia", "Rimuovi dati offline", "Attiva aggiornamento disponibile", "Stima dello spazio non disponibile.", "Il browser non ha concesso lo spazio persistente.", "Il browser non ha completato la richiesta di archiviazione."),
 "ru": ("Настройки автономной оболочки", "Кэшируются только небольшая статическая оболочка и страница подключения. Инструменты и внешние библиотеки офлайн не работают.", "Попросить браузер сохранить оболочку", "Удалить автономные данные", "Активировать доступное обновление", "Оценка хранилища недоступна.", "Браузер не предоставил постоянное хранилище.", "Браузер не смог выполнить запрос к хранилищу."),
 "ja": ("オフラインシェル設定", "小さな静的シェルと接続案内だけをキャッシュします。文書ツールと外部ライブラリはオフラインでは利用できません。", "シェルデータの保持をブラウザーに依頼", "オフラインデータを削除", "利用可能な更新を有効化", "ストレージ容量を取得できません。", "永続ストレージは許可されませんでした。", "ストレージ要求を完了できませんでした。"),
 "ko": ("오프라인 셸 설정", "작은 정적 셸과 연결 안내 페이지만 캐시합니다. 문서 도구와 외부 라이브러리는 오프라인에서 사용할 수 없습니다.", "브라우저에 셸 데이터 보존 요청", "오프라인 데이터 제거", "사용 가능한 업데이트 활성화", "저장 공간 추정치를 사용할 수 없습니다.", "브라우저가 영구 저장 공간을 허용하지 않았습니다.", "브라우저가 저장 공간 요청을 완료하지 못했습니다."),
 "zh": ("离线外壳设置", "仅缓存少量静态外壳和连接提示页。文档工具和外部处理库未启用离线使用。", "请求浏览器保留外壳数据", "删除离线数据", "启用可用更新", "无法获取存储空间估算。", "浏览器未授予持久存储权限。", "浏览器无法完成存储请求。"),
 "zh-TW": ("離線外殼設定", "只快取少量靜態外殼與連線提示頁。文件工具與外部處理程式庫未啟用離線使用。", "要求瀏覽器保留外殼資料", "移除離線資料", "啟用可用更新", "無法取得儲存空間估算。", "瀏覽器未授予永久儲存權限。", "瀏覽器無法完成儲存要求。"),
 "ar": ("إعدادات الغلاف دون اتصال", "لا يُخزّن سوى غلاف ثابت صغير وصفحة لتنبيه الاتصال. الأدوات والمكتبات الخارجية غير متاحة دون اتصال.", "اطلب من المتصفح الاحتفاظ ببيانات الغلاف", "إزالة بيانات عدم الاتصال", "تنشيط التحديث المتاح", "تقدير مساحة التخزين غير متاح.", "لم يمنح المتصفح تخزينًا دائمًا.", "تعذر على المتصفح إكمال طلب التخزين."),
 "hi": ("ऑफ़लाइन शेल सेटिंग", "केवल छोटा स्थिर शेल और कनेक्शन सूचना पेज कैश होते हैं। दस्तावेज़ टूल और बाहरी लाइब्रेरी ऑफ़लाइन सक्षम नहीं हैं।", "ब्राउज़र से शेल डेटा रखने को कहें", "ऑफ़लाइन डेटा हटाएँ", "उपलब्ध अपडेट सक्रिय करें", "स्टोरेज का अनुमान उपलब्ध नहीं है।", "ब्राउज़र ने स्थायी स्टोरेज की अनुमति नहीं दी।", "ब्राउज़र स्टोरेज अनुरोध पूरा नहीं कर सका।"),
 "tr": ("Çevrimdışı kabuk ayarları", "Yalnızca küçük bir statik kabuk ve bağlantı uyarısı önbelleğe alınır. Belge araçları ve harici kitaplıklar çevrimdışı kullanıma açık değildir.", "Tarayıcıdan kabuk verilerini korumasını iste", "Çevrimdışı verileri kaldır", "Mevcut güncellemeyi etkinleştir", "Depolama tahmini kullanılamıyor.", "Tarayıcı kalıcı depolamaya izin vermedi.", "Tarayıcı depolama isteğini tamamlayamadı."),
 "nl": ("Instellingen voor offline shell", "Alleen een kleine statische shell en verbindingspagina worden gecachet. Documenthulpmiddelen en externe bibliotheken werken niet offline.", "Browser vragen shellgegevens te bewaren", "Offlinegegevens verwijderen", "Beschikbare update activeren", "Opslagschatting niet beschikbaar.", "De browser heeft geen permanente opslag toegestaan.", "De browser kon het opslagverzoek niet voltooien."),
 "pl": ("Ustawienia powłoki offline", "Buforowana jest tylko mała statyczna powłoka i strona połączenia. Narzędzia i biblioteki zewnętrzne nie działają offline.", "Poproś przeglądarkę o zachowanie powłoki", "Usuń dane offline", "Aktywuj dostępną aktualizację", "Szacowanie pamięci jest niedostępne.", "Przeglądarka nie przyznała trwałej pamięci.", "Przeglądarka nie mogła wykonać żądania pamięci."),
 "id": ("Pengaturan shell offline", "Hanya shell statis kecil dan halaman koneksi yang disimpan. Alat dokumen dan pustaka eksternal tidak aktif saat offline.", "Minta browser menyimpan data shell", "Hapus data offline", "Aktifkan pembaruan yang tersedia", "Perkiraan penyimpanan tidak tersedia.", "Browser tidak memberikan penyimpanan persisten.", "Browser tidak dapat menyelesaikan permintaan penyimpanan."),
 "vi": ("Cài đặt giao diện ngoại tuyến", "Chỉ giao diện tĩnh nhỏ và trang báo kết nối được lưu đệm. Công cụ tài liệu và thư viện ngoài không hoạt động ngoại tuyến.", "Yêu cầu trình duyệt giữ dữ liệu giao diện", "Xóa dữ liệu ngoại tuyến", "Kích hoạt bản cập nhật có sẵn", "Không có ước tính dung lượng lưu trữ.", "Trình duyệt không cấp bộ nhớ lâu dài.", "Trình duyệt không thể hoàn tất yêu cầu lưu trữ."),
 "th": ("การตั้งค่าเชลล์ออฟไลน์", "แคชเฉพาะเชลล์แบบคงที่ขนาดเล็กและหน้าแจ้งการเชื่อมต่อ เครื่องมือเอกสารและไลบรารีภายนอกไม่เปิดใช้งานแบบออฟไลน์", "ขอให้เบราว์เซอร์เก็บข้อมูลเชลล์", "ลบข้อมูลออฟไลน์", "เปิดใช้การอัปเดตที่มี", "ไม่มีข้อมูลประมาณการพื้นที่จัดเก็บ", "เบราว์เซอร์ไม่อนุญาตพื้นที่จัดเก็บถาวร", "เบราว์เซอร์ดำเนินการคำขอพื้นที่จัดเก็บไม่สำเร็จ"),
 "uk": ("Налаштування автономної оболонки", "Кешуються лише невелика статична оболонка та сторінка з’єднання. Інструменти й зовнішні бібліотеки офлайн не працюють.", "Попросити браузер зберегти оболонку", "Видалити автономні дані", "Активувати доступне оновлення", "Оцінка сховища недоступна.", "Браузер не надав постійне сховище.", "Браузер не зміг виконати запит до сховища."),
 "cs": ("Nastavení offline prostředí", "Do mezipaměti se ukládá jen malé statické prostředí a stránka připojení. Nástroje ani externí knihovny offline nefungují.", "Požádat prohlížeč o uchování prostředí", "Odstranit offline data", "Aktivovat dostupnou aktualizaci", "Odhad úložiště není dostupný.", "Prohlížeč nepovolil trvalé úložiště.", "Prohlížeč nemohl dokončit požadavek na úložiště."),
 "sv": ("Inställningar för offlineskal", "Endast ett litet statiskt skal och en anslutningssida cachelagras. Dokumentverktyg och externa bibliotek är inte aktiverade offline.", "Be webbläsaren behålla skaldata", "Ta bort offlinedata", "Aktivera tillgänglig uppdatering", "Lagringsuppskattning är inte tillgänglig.", "Webbläsaren beviljade inte beständig lagring.", "Webbläsaren kunde inte slutföra lagringsbegäran."),
}

# persistent storage granted, owned data removed, waiting update activated
STATUS = {
 "es": ("El navegador concedió almacenamiento persistente.", "Se eliminaron los datos y el registro sin conexión de BrowserPDF.", "Actualización activada. Recargue cuando esté listo."),
 "fr": ("Le navigateur a accordé le stockage persistant.", "Les données et l’inscription hors connexion de BrowserPDF ont été supprimées.", "Mise à jour activée. Rechargez la page quand vous le souhaitez."),
 "de": ("Der Browser hat dauerhaften Speicher gewährt.", "Offline-Daten und Registrierung von BrowserPDF wurden entfernt.", "Update aktiviert. Laden Sie neu, wenn Sie bereit sind."),
 "pt": ("O navegador concedeu armazenamento persistente.", "Os dados e o registo offline do BrowserPDF foram removidos.", "Atualização ativada. Recarregue quando estiver pronto."),
 "it": ("Il browser ha concesso lo spazio persistente.", "I dati e la registrazione offline di BrowserPDF sono stati rimossi.", "Aggiornamento attivato. Ricarica quando vuoi."),
 "ru": ("Браузер предоставил постоянное хранилище.", "Автономные данные и регистрация BrowserPDF удалены.", "Обновление активировано. Перезагрузите страницу, когда будете готовы."),
 "ja": ("ブラウザーが永続ストレージを許可しました。", "BrowserPDF のオフラインデータと登録を削除しました。", "更新を有効にしました。準備ができたら再読み込みしてください。"),
 "ko": ("브라우저가 영구 저장 공간을 허용했습니다.", "BrowserPDF 오프라인 데이터와 등록을 제거했습니다.", "업데이트가 활성화되었습니다. 준비되면 새로고침하세요."),
 "zh": ("浏览器已授予持久存储权限。", "已删除 BrowserPDF 离线数据和注册。", "更新已启用。请在准备好后重新加载。"),
 "zh-TW": ("瀏覽器已授予永久儲存權限。", "已移除 BrowserPDF 離線資料與註冊。", "更新已啟用。準備好後請重新載入。"),
 "ar": ("منح المتصفح تخزينًا دائمًا.", "تمت إزالة بيانات BrowserPDF دون اتصال وتسجيله.", "تم تنشيط التحديث. أعد التحميل عندما تكون مستعدًا."),
 "hi": ("ब्राउज़र ने स्थायी स्टोरेज की अनुमति दी।", "BrowserPDF का ऑफ़लाइन डेटा और पंजीकरण हटा दिया गया।", "अपडेट सक्रिय है। तैयार होने पर पेज फिर लोड करें।"),
 "tr": ("Tarayıcı kalıcı depolamaya izin verdi.", "BrowserPDF çevrimdışı verileri ve kaydı kaldırıldı.", "Güncelleme etkinleştirildi. Hazır olduğunuzda sayfayı yenileyin."),
 "nl": ("De browser heeft permanente opslag toegestaan.", "De offlinegegevens en registratie van BrowserPDF zijn verwijderd.", "Update geactiveerd. Herlaad wanneer u klaar bent."),
 "pl": ("Przeglądarka przyznała trwałą pamięć.", "Dane offline i rejestracja BrowserPDF zostały usunięte.", "Aktualizacja została aktywowana. Odśwież stronę, gdy zechcesz."),
 "id": ("Browser memberikan penyimpanan persisten.", "Data dan pendaftaran offline BrowserPDF telah dihapus.", "Pembaruan diaktifkan. Muat ulang saat Anda siap."),
 "vi": ("Trình duyệt đã cấp bộ nhớ lâu dài.", "Dữ liệu và đăng ký ngoại tuyến của BrowserPDF đã được xóa.", "Bản cập nhật đã được kích hoạt. Hãy tải lại khi bạn sẵn sàng."),
 "th": ("เบราว์เซอร์อนุญาตพื้นที่จัดเก็บถาวรแล้ว", "ลบข้อมูลและการลงทะเบียนออฟไลน์ของ BrowserPDF แล้ว", "เปิดใช้การอัปเดตแล้ว โหลดหน้าใหม่เมื่อพร้อม"),
 "uk": ("Браузер надав постійне сховище.", "Автономні дані та реєстрацію BrowserPDF видалено.", "Оновлення активовано. Перезавантажте сторінку, коли будете готові."),
 "cs": ("Prohlížeč povolil trvalé úložiště.", "Offline data a registrace BrowserPDF byly odstraněny.", "Aktualizace byla aktivována. Až budete chtít, načtěte stránku znovu."),
 "sv": ("Webbläsaren beviljade beständig lagring.", "BrowserPDF:s offlinedata och registrering har tagits bort.", "Uppdateringen har aktiverats. Ladda om när du är redo."),
}

def migrate(locale, values):
    title, capability, persist, remove, update, storage_unknown, persist_denied, action_failed = values
    locale.update({
      "pwa.title": title, "pwa.capability": capability,
      "pwa.storage_unknown": storage_unknown, "pwa.storage_usage": "{used} MB / {quota} MB",
      "pwa.persist": persist, "pwa.remove": remove, "pwa.update": update,
      "pwa.registered": capability, "pwa.persist_denied": persist_denied,
      "pwa.action_failed": action_failed,
    })

def main():
    parser = argparse.ArgumentParser(); parser.add_argument("--check", action="store_true"); args = parser.parse_args()
    original = PATH.read_text(encoding="utf-8"); data = json.loads(original)
    if set(data) != set(CORE): raise SystemExit("Phase 8 locale map mismatch")
    if set(STATUS) != set(CORE): raise SystemExit("Phase 8 status locale map mismatch")
    for language, locale in data.items():
        migrate(locale, CORE[language])
        persisted, removed, update_activated = STATUS[language]
        locale.update({
          "pwa.persisted": persisted, "pwa.removed": removed,
          "pwa.update_activated": update_activated,
        })
    rendered = json.dumps(data, ensure_ascii=False, indent=2) + "\n"
    if args.check:
        if rendered != original: raise SystemExit("Phase 8 translation migration is not up to date")
    else: PATH.write_text(rendered, encoding="utf-8")

if __name__ == "__main__": main()
