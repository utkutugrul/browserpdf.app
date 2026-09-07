#!/usr/bin/env python3
"""Apply the Phase 1 privacy/accessibility copy migration to every locale.

The update assigns deterministic values, so running it repeatedly produces the
same translations.json bytes.
"""

import argparse
import json
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
TRANSLATIONS = ROOT / "public" / "translations.json"

# processing, no_upload, source, analytics, free, libraries, skip, no_results,
# clear, success, region, no_upload_title, multiple, javascript_required
PACKS = {
    "es": (
        "El procesamiento de documentos ocurre en esta pestaña del navegador.",
        "BrowserPDF no tiene un punto de carga de archivos, por lo que los documentos seleccionados no se nos envían.",
        "Código disponible", "El almacenamiento de analíticas permanece desactivado salvo que lo acepte; el almacenamiento publicitario siempre permanece desactivado.",
        "Todas las herramientas son completas, sin cuenta, marcas de agua añadidas ni límites de uso impuestos por el servicio.",
        "El código de la aplicación está disponible; las bibliotecas de código abierto usan versiones fijadas y verificación criptográfica.",
        "Saltar al contenido principal", "Ninguna herramienta coincide con su búsqueda.", "Borrar búsqueda", "Fusión completada. Su PDF se ha descargado.",
        "Preferencias de analíticas", "Sin carga de documentos", ", añada varios archivos", "JavaScript es necesario para usar esta página.",
    ),
    "fr": (
        "Le traitement des documents s’effectue dans cet onglet du navigateur.",
        "BrowserPDF n’a aucun point de téléversement de fichiers : les documents sélectionnés ne nous sont pas envoyés.",
        "Code source disponible", "Le stockage analytique reste refusé sauf si vous l’acceptez ; le stockage publicitaire reste toujours refusé.",
        "Chaque outil est complet, sans compte, filigrane ajouté ni limite d’utilisation imposée par le service.",
        "Le code de l’application est consultable ; les bibliothèques libres utilisent des versions épinglées et une vérification cryptographique.",
        "Aller au contenu principal", "Aucun outil ne correspond à votre recherche.", "Effacer la recherche", "Fusion terminée. Votre PDF a été téléchargé.",
        "Préférences d’analyse", "Aucun téléversement de document", ", ajoutez plusieurs fichiers", "JavaScript est nécessaire pour utiliser cette page.",
    ),
    "de": (
        "Die Dokumentverarbeitung findet in diesem Browser-Tab statt.",
        "BrowserPDF hat keinen Datei-Upload-Endpunkt; ausgewählte Dokumente werden daher nicht an uns gesendet.",
        "Quellcode einsehbar", "Analysespeicher bleibt abgelehnt, sofern Sie nicht zustimmen; Werbespeicher bleibt immer abgelehnt.",
        "Jedes Werkzeug ist vollständig nutzbar – ohne Konto, hinzugefügte Wasserzeichen oder dienstseitige Nutzungslimits.",
        "Der Anwendungscode ist einsehbar; Open-Source-Bibliotheken nutzen festgelegte Versionen und kryptografische Prüfung.",
        "Zum Hauptinhalt springen", "Keine Werkzeuge entsprechen Ihrer Suche.", "Suche löschen", "Zusammenführen abgeschlossen. Ihre PDF wurde heruntergeladen.",
        "Analyseeinstellungen", "Kein Dokument-Upload", ", mehrere Dateien hinzufügen", "JavaScript ist zur Nutzung dieser Seite erforderlich.",
    ),
    "pt": (
        "O processamento de documentos acontece neste separador do navegador.",
        "O BrowserPDF não tem um ponto de carregamento de ficheiros, por isso os documentos selecionados não nos são enviados.",
        "Código disponível", "O armazenamento de análise permanece recusado a menos que aceite; o armazenamento de publicidade permanece sempre recusado.",
        "Todas as ferramentas são completas, sem conta, marcas de água adicionadas ou limites de utilização impostos pelo serviço.",
        "O código da aplicação está disponível; as bibliotecas de código aberto usam versões fixas e verificação criptográfica.",
        "Saltar para o conteúdo principal", "Nenhuma ferramenta corresponde à sua pesquisa.", "Limpar pesquisa", "Fusão concluída. O seu PDF foi transferido.",
        "Preferências de análise", "Sem carregamento de documentos", ", adicione vários ficheiros", "É necessário JavaScript para utilizar esta página.",
    ),
    "it": (
        "L’elaborazione dei documenti avviene in questa scheda del browser.",
        "BrowserPDF non ha un endpoint di caricamento file, quindi i documenti selezionati non ci vengono inviati.",
        "Codice disponibile", "L’archiviazione per le analisi resta negata se non la accetti; l’archiviazione pubblicitaria resta sempre negata.",
        "Ogni strumento è completo, senza account, filigrane aggiunte o limiti di utilizzo imposti dal servizio.",
        "Il codice dell’applicazione è disponibile; le librerie open source usano versioni bloccate e verifica crittografica.",
        "Vai al contenuto principale", "Nessuno strumento corrisponde alla ricerca.", "Cancella ricerca", "Unione completata. Il PDF è stato scaricato.",
        "Preferenze di analisi", "Nessun caricamento di documenti", ", aggiungi più file", "JavaScript è necessario per usare questa pagina.",
    ),
    "ru": (
        "Обработка документов выполняется в этой вкладке браузера.",
        "У BrowserPDF нет конечной точки загрузки файлов, поэтому выбранные документы не отправляются нам.",
        "Исходный код доступен", "Хранилище аналитики остаётся запрещённым, пока вы не согласитесь; рекламное хранилище всегда запрещено.",
        "Все инструменты полнофункциональны: без аккаунта, добавленных водяных знаков и ограничений сервиса.",
        "Код приложения доступен; библиотеки с открытым исходным кодом используют закреплённые версии и криптографическую проверку.",
        "Перейти к основному содержимому", "По вашему запросу инструменты не найдены.", "Очистить поиск", "Объединение завершено. PDF загружен.",
        "Настройки аналитики", "Без загрузки документов", ", добавьте несколько файлов", "Для работы этой страницы требуется JavaScript.",
    ),
    "ja": (
        "ドキュメントの処理はこのブラウザータブ内で行われます。",
        "BrowserPDF にはファイルアップロード用エンドポイントがないため、選択したドキュメントが当方へ送信されることはありません。",
        "ソース公開", "同意しない限り分析ストレージは拒否され、広告ストレージは常に拒否されます。",
        "すべてのツールは、アカウント、追加の透かし、サービス側の使用制限なしで全機能を利用できます。",
        "アプリケーションコードは公開され、オープンソースライブラリはバージョン固定と暗号学的検証を使用します。",
        "メインコンテンツへ移動", "検索に一致するツールはありません。", "検索をクリア", "結合が完了しました。PDF をダウンロードしました。",
        "分析設定", "ドキュメントのアップロードなし", "、複数のファイルを追加できます", "このページの利用には JavaScript が必要です。",
    ),
    "ko": (
        "문서 처리는 이 브라우저 탭에서 이루어집니다.",
        "BrowserPDF에는 파일 업로드 엔드포인트가 없으므로 선택한 문서가 당사로 전송되지 않습니다.",
        "소스 공개", "동의하지 않으면 분석 저장이 거부되며 광고 저장은 항상 거부됩니다.",
        "모든 도구는 계정, 추가 워터마크 또는 서비스가 부과하는 사용 제한 없이 모든 기능을 제공합니다.",
        "애플리케이션 코드는 공개되어 있으며 오픈 소스 라이브러리는 고정 버전과 암호화 검증을 사용합니다.",
        "주요 콘텐츠로 건너뛰기", "검색과 일치하는 도구가 없습니다.", "검색 지우기", "병합이 완료되었습니다. PDF가 다운로드되었습니다.",
        "분석 환경설정", "문서 업로드 없음", ", 여러 파일 추가", "이 페이지를 사용하려면 JavaScript가 필요합니다.",
    ),
    "zh": (
        "文档处理在此浏览器标签页中进行。",
        "BrowserPDF 没有文件上传端点，因此所选文档不会发送给我们。",
        "源代码可查看", "除非您同意，否则分析存储保持拒绝；广告存储始终保持拒绝。",
        "所有工具均功能完整，无需账户、不会添加水印，也没有服务强制的使用限制。",
        "应用代码可查看；开源库使用固定版本并进行加密哈希验证。",
        "跳到主要内容", "没有工具与您的搜索匹配。", "清除搜索", "合并完成。您的 PDF 已下载。",
        "分析偏好", "不上传文档", "，添加多个文件", "使用此页面需要 JavaScript。",
    ),
    "zh-TW": (
        "文件處理在此瀏覽器分頁中進行。",
        "BrowserPDF 沒有檔案上傳端點，因此所選文件不會傳送給我們。",
        "原始碼可查看", "除非您同意，否則分析儲存會維持拒絕；廣告儲存一律維持拒絕。",
        "所有工具功能完整，無需帳戶、不會加入浮水印，也沒有服務強制的使用限制。",
        "應用程式原始碼可查看；開源程式庫採用固定版本及密碼雜湊驗證。",
        "跳到主要內容", "沒有工具符合您的搜尋。", "清除搜尋", "合併完成。您的 PDF 已下載。",
        "分析偏好設定", "不上傳文件", "，加入多個檔案", "使用此頁面需要 JavaScript。",
    ),
    "ar": (
        "تتم معالجة المستندات في علامة تبويب المتصفح هذه.",
        "لا يملك BrowserPDF نقطة نهاية لرفع الملفات، لذلك لا تُرسل إلينا المستندات المحددة.",
        "الشيفرة متاحة", "يظل تخزين التحليلات مرفوضًا ما لم توافق عليه؛ ويظل تخزين الإعلانات مرفوضًا دائمًا.",
        "كل أداة كاملة الوظائف بلا حساب أو علامات مائية مضافة أو حدود استخدام تفرضها الخدمة.",
        "شيفرة التطبيق متاحة؛ وتستخدم المكتبات مفتوحة المصدر إصدارات مثبتة وتحققًا تشفيريًا.",
        "الانتقال إلى المحتوى الرئيسي", "لا توجد أدوات تطابق بحثك.", "مسح البحث", "اكتمل الدمج. تم تنزيل ملف PDF.",
        "تفضيلات التحليلات", "لا رفع للمستندات", "، أضف ملفات متعددة", "يلزم JavaScript لاستخدام هذه الصفحة.",
    ),
    "hi": (
        "दस्तावेज़ की प्रोसेसिंग इसी ब्राउज़र टैब में होती है।",
        "BrowserPDF में फ़ाइल अपलोड एंडपॉइंट नहीं है, इसलिए चुने गए दस्तावेज़ हमें नहीं भेजे जाते।",
        "स्रोत उपलब्ध", "आपकी सहमति के बिना एनालिटिक्स स्टोरेज अस्वीकृत रहता है; विज्ञापन स्टोरेज हमेशा अस्वीकृत रहता है।",
        "हर टूल पूरी तरह काम करता है—बिना खाते, जोड़े गए वॉटरमार्क या सेवा द्वारा लगाए उपयोग प्रतिबंध के।",
        "ऐप्लिकेशन कोड उपलब्ध है; ओपन-सोर्स लाइब्रेरी तय संस्करण और क्रिप्टोग्राफ़िक सत्यापन उपयोग करती हैं।",
        "मुख्य सामग्री पर जाएँ", "आपकी खोज से कोई टूल मेल नहीं खाता।", "खोज साफ़ करें", "मर्ज पूरा हुआ। आपका PDF डाउनलोड हो गया है।",
        "एनालिटिक्स प्राथमिकताएँ", "दस्तावेज़ अपलोड नहीं", ", कई फ़ाइलें जोड़ें", "इस पेज के लिए JavaScript आवश्यक है।",
    ),
    "tr": (
        "Belge işleme bu tarayıcı sekmesinde gerçekleşir.",
        "BrowserPDF'de dosya yükleme uç noktası yoktur; bu nedenle seçtiğiniz belgeler bize gönderilmez.",
        "Kaynak kodu erişilebilir", "Siz kabul etmedikçe analiz depolama reddedilir; reklam depolama her zaman reddedilir.",
        "Tüm araçlar hesap, eklenmiş filigran veya hizmet tarafından konan kullanım sınırı olmadan tam işlevlidir.",
        "Uygulama kodu erişilebilirdir; açık kaynak kitaplıklar sabit sürüm ve kriptografik doğrulama kullanır.",
        "Ana içeriğe geç", "Aramanızla eşleşen araç yok.", "Aramayı temizle", "Birleştirme tamamlandı. PDF dosyanız indirildi.",
        "Analiz tercihleri", "Belge yükleme yok", ", birden fazla dosya ekleyin", "Bu sayfayı kullanmak için JavaScript gereklidir.",
    ),
    "nl": (
        "Documentverwerking gebeurt in dit browsertabblad.",
        "BrowserPDF heeft geen eindpunt voor bestandsuploads; geselecteerde documenten worden dus niet naar ons verzonden.",
        "Broncode beschikbaar", "Analytische opslag blijft geweigerd tenzij u instemt; advertentieopslag blijft altijd geweigerd.",
        "Elke tool is volledig bruikbaar, zonder account, toegevoegde watermerken of door de dienst opgelegde gebruikslimieten.",
        "De applicatiecode is beschikbaar; opensourcebibliotheken gebruiken vastgezette versies en cryptografische verificatie.",
        "Naar hoofdinhoud", "Geen tools komen overeen met uw zoekopdracht.", "Zoekopdracht wissen", "Samenvoegen voltooid. Uw PDF is gedownload.",
        "Analysevoorkeuren", "Geen documentupload", ", voeg meerdere bestanden toe", "JavaScript is vereist om deze pagina te gebruiken.",
    ),
    "pl": (
        "Przetwarzanie dokumentów odbywa się w tej karcie przeglądarki.",
        "BrowserPDF nie ma punktu przesyłania plików, więc wybrane dokumenty nie są do nas wysyłane.",
        "Kod źródłowy dostępny", "Pamięć analityczna pozostaje wyłączona bez Twojej zgody; pamięć reklamowa jest zawsze wyłączona.",
        "Każde narzędzie jest w pełni funkcjonalne, bez konta, dodanych znaków wodnych ani limitów użycia narzuconych przez usługę.",
        "Kod aplikacji jest dostępny; biblioteki open source używają przypiętych wersji i weryfikacji kryptograficznej.",
        "Przejdź do głównej treści", "Żadne narzędzie nie pasuje do wyszukiwania.", "Wyczyść wyszukiwanie", "Scalanie zakończone. Plik PDF został pobrany.",
        "Ustawienia analityki", "Bez przesyłania dokumentów", ", dodaj wiele plików", "Do użycia tej strony wymagany jest JavaScript.",
    ),
    "id": (
        "Pemrosesan dokumen berlangsung di tab browser ini.",
        "BrowserPDF tidak memiliki endpoint unggah file, jadi dokumen yang dipilih tidak dikirim kepada kami.",
        "Kode sumber tersedia", "Penyimpanan analitik tetap ditolak kecuali Anda menyetujuinya; penyimpanan iklan selalu ditolak.",
        "Setiap alat berfungsi penuh tanpa akun, tanda air tambahan, atau batas penggunaan dari layanan.",
        "Kode aplikasi tersedia; pustaka sumber terbuka memakai versi yang dipatok dan verifikasi kriptografis.",
        "Lewati ke konten utama", "Tidak ada alat yang cocok dengan pencarian Anda.", "Hapus pencarian", "Penggabungan selesai. PDF Anda telah diunduh.",
        "Preferensi analitik", "Tanpa unggah dokumen", ", tambahkan beberapa file", "JavaScript diperlukan untuk memakai halaman ini.",
    ),
    "vi": (
        "Tài liệu được xử lý trong thẻ trình duyệt này.",
        "BrowserPDF không có điểm cuối tải tệp lên, vì vậy tài liệu đã chọn không được gửi cho chúng tôi.",
        "Mã nguồn có sẵn", "Bộ nhớ phân tích bị từ chối trừ khi bạn chấp nhận; bộ nhớ quảng cáo luôn bị từ chối.",
        "Mọi công cụ đều đầy đủ chức năng, không cần tài khoản, không thêm hình mờ và không có giới hạn sử dụng do dịch vụ đặt ra.",
        "Mã ứng dụng có sẵn; thư viện nguồn mở dùng phiên bản cố định và xác minh mật mã.",
        "Chuyển đến nội dung chính", "Không có công cụ nào khớp với tìm kiếm.", "Xóa tìm kiếm", "Đã ghép xong. PDF của bạn đã được tải xuống.",
        "Tùy chọn phân tích", "Không tải tài liệu lên", ", thêm nhiều tệp", "Cần JavaScript để sử dụng trang này.",
    ),
    "th": (
        "การประมวลผลเอกสารเกิดขึ้นในแท็บเบราว์เซอร์นี้",
        "BrowserPDF ไม่มีปลายทางสำหรับอัปโหลดไฟล์ ดังนั้นเอกสารที่เลือกจะไม่ถูกส่งถึงเรา",
        "เปิดดูซอร์สได้", "พื้นที่เก็บข้อมูลการวิเคราะห์จะถูกปฏิเสธเว้นแต่คุณยอมรับ และพื้นที่เก็บข้อมูลโฆษณาจะถูกปฏิเสธเสมอ",
        "เครื่องมือทุกชิ้นทำงานได้เต็มรูปแบบ โดยไม่ต้องมีบัญชี ไม่มีลายน้ำที่เพิ่ม และไม่มีขีดจำกัดจากบริการ",
        "เปิดดูโค้ดแอปได้ ไลบรารีโอเพนซอร์สใช้เวอร์ชันที่ตรึงและการตรวจสอบแบบเข้ารหัส",
        "ข้ามไปยังเนื้อหาหลัก", "ไม่มีเครื่องมือที่ตรงกับการค้นหา", "ล้างการค้นหา", "รวมเสร็จแล้ว ดาวน์โหลด PDF ของคุณแล้ว",
        "การตั้งค่าการวิเคราะห์", "ไม่มีการอัปโหลดเอกสาร", ", เพิ่มหลายไฟล์", "ต้องใช้ JavaScript เพื่อใช้หน้านี้",
    ),
    "uk": (
        "Обробка документів відбувається в цій вкладці браузера.",
        "BrowserPDF не має кінцевої точки завантаження файлів, тому вибрані документи не надсилаються нам.",
        "Вихідний код доступний", "Сховище аналітики залишається забороненим без вашої згоди; рекламне сховище завжди заборонене.",
        "Усі інструменти повністю функціональні: без облікового запису, доданих водяних знаків і обмежень сервісу.",
        "Код застосунку доступний; бібліотеки з відкритим кодом використовують закріплені версії та криптографічну перевірку.",
        "Перейти до основного вмісту", "Немає інструментів, що відповідають пошуку.", "Очистити пошук", "Об’єднання завершено. PDF завантажено.",
        "Налаштування аналітики", "Без завантаження документів", ", додайте кілька файлів", "Для цієї сторінки потрібен JavaScript.",
    ),
    "cs": (
        "Zpracování dokumentů probíhá v této kartě prohlížeče.",
        "BrowserPDF nemá koncový bod pro nahrávání souborů, takže vybrané dokumenty nejsou odesílány k nám.",
        "Zdrojový kód k dispozici", "Úložiště analytiky zůstává odmítnuté, dokud nesouhlasíte; reklamní úložiště zůstává vždy odmítnuté.",
        "Každý nástroj je plně funkční bez účtu, přidaných vodoznaků či omezení používání ze strany služby.",
        "Kód aplikace je k dispozici; open-source knihovny používají pevné verze a kryptografické ověření.",
        "Přeskočit na hlavní obsah", "Vašemu hledání neodpovídají žádné nástroje.", "Vymazat hledání", "Sloučení dokončeno. Soubor PDF byl stažen.",
        "Předvolby analytiky", "Bez nahrávání dokumentů", ", přidejte více souborů", "Pro použití této stránky je vyžadován JavaScript.",
    ),
    "sv": (
        "Dokumentbehandlingen sker i den här webbläsarfliken.",
        "BrowserPDF har ingen slutpunkt för filuppladdning, så valda dokument skickas inte till oss.",
        "Källkod tillgänglig", "Analyslagring förblir nekad om du inte godkänner den; annonslagring förblir alltid nekad.",
        "Varje verktyg är fullt fungerande utan konto, tillagda vattenstämplar eller tjänstepåtvingade användningsgränser.",
        "Applikationskoden är tillgänglig; bibliotek med öppen källkod använder låsta versioner och kryptografisk verifiering.",
        "Hoppa till huvudinnehållet", "Inga verktyg matchar din sökning.", "Rensa sökning", "Sammanslagningen är klar. Din PDF har hämtats.",
        "Analysinställningar", "Ingen dokumentuppladdning", ", lägg till flera filer", "JavaScript krävs för att använda den här sidan.",
    ),
}

SELECT_FILES = {
    "es": "Seleccione o añada archivos desde su dispositivo.",
    "fr": "Sélectionnez ou ajoutez des fichiers depuis votre appareil.",
    "de": "Dateien von Ihrem Gerät auswählen oder hinzufügen.",
    "pt": "Selecione ou adicione ficheiros do seu dispositivo.",
    "it": "Seleziona o aggiungi file dal tuo dispositivo.",
    "ru": "Выберите или добавьте файлы с устройства.",
    "ja": "デバイスからファイルを選択または追加します。",
    "ko": "기기에서 파일을 선택하거나 추가하세요.",
    "zh": "从您的设备选择或添加文件。",
    "zh-TW": "從您的裝置選取或加入檔案。",
    "ar": "حدّد ملفات من جهازك أو أضفها.",
    "hi": "अपने डिवाइस से फ़ाइलें चुनें या जोड़ें।",
    "tr": "Cihazınızdan dosya seçin veya ekleyin.",
    "nl": "Selecteer of voeg bestanden toe vanaf uw apparaat.",
    "pl": "Wybierz lub dodaj pliki ze swojego urządzenia.",
    "id": "Pilih atau tambahkan file dari perangkat Anda.",
    "vi": "Chọn hoặc thêm tệp từ thiết bị của bạn.",
    "th": "เลือกหรือเพิ่มไฟล์จากอุปกรณ์ของคุณ",
    "uk": "Виберіть або додайте файли зі свого пристрою.",
    "cs": "Vyberte nebo přidejte soubory ze svého zařízení.",
    "sv": "Välj eller lägg till filer från din enhet.",
}

WORD_TO_PDF_INTRO = {
    "es": "Convierta un archivo .docx a PDF localmente en esta pestaña del navegador. BrowserPDF no tiene un punto de carga de archivos.",
    "fr": "Convertissez un fichier .docx en PDF localement dans cet onglet du navigateur. BrowserPDF n’a aucun point de téléversement de fichiers.",
    "de": "Konvertieren Sie eine .docx-Datei lokal in diesem Browser-Tab in PDF. BrowserPDF hat keinen Datei-Upload-Endpunkt.",
    "pt": "Converta um ficheiro .docx em PDF localmente neste separador do navegador. O BrowserPDF não tem um ponto de carregamento de ficheiros.",
    "it": "Converti un file .docx in PDF localmente in questa scheda del browser. BrowserPDF non ha un endpoint di caricamento file.",
    "ru": "Преобразуйте файл .docx в PDF локально в этой вкладке браузера. У BrowserPDF нет конечной точки загрузки файлов.",
    "ja": ".docx ファイルをこのブラウザータブ内でローカルに PDF へ変換します。BrowserPDF にはファイルアップロード用エンドポイントがありません。",
    "ko": ".docx 파일을 이 브라우저 탭에서 로컬로 PDF로 변환합니다. BrowserPDF에는 파일 업로드 엔드포인트가 없습니다.",
    "zh": "在此浏览器标签页中本地将 .docx 文件转换为 PDF。BrowserPDF 没有文件上传端点。",
    "zh-TW": "在此瀏覽器分頁中於本機將 .docx 檔案轉換為 PDF。BrowserPDF 沒有檔案上傳端點。",
    "ar": "حوّل ملف .docx إلى PDF محليًا في علامة تبويب المتصفح هذه. لا يملك BrowserPDF نقطة نهاية لرفع الملفات.",
    "hi": ".docx फ़ाइल को इस ब्राउज़र टैब में स्थानीय रूप से PDF में बदलें। BrowserPDF में फ़ाइल अपलोड एंडपॉइंट नहीं है।",
    "tr": "Bir .docx dosyasını bu tarayıcı sekmesinde yerel olarak PDF'ye dönüştürün. BrowserPDF'de dosya yükleme uç noktası yoktur.",
    "nl": "Converteer een .docx-bestand lokaal in dit browsertabblad naar PDF. BrowserPDF heeft geen eindpunt voor bestandsuploads.",
    "pl": "Przekonwertuj plik .docx lokalnie w tej karcie przeglądarki do PDF. BrowserPDF nie ma punktu przesyłania plików.",
    "id": "Konversikan file .docx ke PDF secara lokal di tab browser ini. BrowserPDF tidak memiliki endpoint unggah file.",
    "vi": "Chuyển đổi tệp .docx sang PDF cục bộ trong thẻ trình duyệt này. BrowserPDF không có điểm cuối tải tệp lên.",
    "th": "แปลงไฟล์ .docx เป็น PDF ภายในแท็บเบราว์เซอร์นี้แบบในเครื่อง BrowserPDF ไม่มีปลายทางสำหรับอัปโหลดไฟล์",
    "uk": "Перетворіть файл .docx у PDF локально в цій вкладці браузера. BrowserPDF не має кінцевої точки завантаження файлів.",
    "cs": "Převeďte soubor .docx do PDF lokálně v této kartě prohlížeče. BrowserPDF nemá koncový bod pro nahrávání souborů.",
    "sv": "Konvertera en .docx-fil till PDF lokalt i den här webbläsarfliken. BrowserPDF har ingen slutpunkt för filuppladdning.",
}

WORD_TO_PDF_DESCRIPTION = {
    "es": "Convierta un archivo .docx a PDF.",
    "fr": "Convertissez un fichier .docx en PDF.",
    "de": "Konvertieren Sie eine .docx-Datei in PDF.",
    "pt": "Converta um ficheiro .docx em PDF.",
    "it": "Converti un file .docx in PDF.",
    "ru": "Преобразуйте файл .docx в PDF.",
    "ja": ".docx ファイルを PDF に変換します。",
    "ko": ".docx 파일을 PDF로 변환합니다.",
    "zh": "将 .docx 文件转换为 PDF。",
    "zh-TW": "將 .docx 檔案轉換為 PDF。",
    "ar": "حوّل ملف .docx إلى PDF.",
    "hi": ".docx फ़ाइल को PDF में बदलें।",
    "tr": "Bir .docx dosyasını PDF'ye dönüştürün.",
    "nl": "Converteer een .docx-bestand naar PDF.",
    "pl": "Przekonwertuj plik .docx do PDF.",
    "id": "Konversikan file .docx ke PDF.",
    "vi": "Chuyển đổi tệp .docx sang PDF.",
    "th": "แปลงไฟล์ .docx เป็น PDF",
    "uk": "Перетворіть файл .docx у PDF.",
    "cs": "Převeďte soubor .docx do PDF.",
    "sv": "Konvertera en .docx-fil till PDF.",
}

JPG_TO_PDF_FAQ = {
    "es": "Las imágenes se incrustan en el PDF localmente en esta pestaña del navegador. BrowserPDF no tiene un punto de carga de archivos.",
    "fr": "Les images sont intégrées au PDF localement dans cet onglet du navigateur. BrowserPDF n’a aucun point de téléversement de fichiers.",
    "de": "Die Bilder werden lokal in diesem Browser-Tab in das PDF eingebettet. BrowserPDF hat keinen Datei-Upload-Endpunkt.",
    "pt": "As imagens são incorporadas no PDF localmente neste separador do navegador. O BrowserPDF não tem um ponto de carregamento de ficheiros.",
    "it": "Le immagini vengono incorporate nel PDF localmente in questa scheda del browser. BrowserPDF non ha un endpoint di caricamento file.",
    "ru": "Изображения встраиваются в PDF локально в этой вкладке браузера. У BrowserPDF нет конечной точки загрузки файлов.",
    "ja": "画像はこのブラウザータブ内でローカルに PDF へ埋め込まれます。BrowserPDF にはファイルアップロード用エンドポイントがありません。",
    "ko": "이미지는 이 브라우저 탭에서 로컬로 PDF에 삽입됩니다. BrowserPDF에는 파일 업로드 엔드포인트가 없습니다.",
    "zh": "图片在此浏览器标签页中本地嵌入 PDF。BrowserPDF 没有文件上传端点。",
    "zh-TW": "圖片在此瀏覽器分頁中於本機嵌入 PDF。BrowserPDF 沒有檔案上傳端點。",
    "ar": "تُضمَّن الصور في ملف PDF محليًا داخل علامة تبويب المتصفح هذه. لا يملك BrowserPDF نقطة نهاية لرفع الملفات.",
    "hi": "छवियों को इस ब्राउज़र टैब में स्थानीय रूप से PDF में एम्बेड किया जाता है। BrowserPDF में फ़ाइल अपलोड एंडपॉइंट नहीं है।",
    "tr": "Görseller bu tarayıcı sekmesinde yerel olarak PDF'ye gömülür. BrowserPDF'de dosya yükleme uç noktası yoktur.",
    "nl": "Afbeeldingen worden lokaal in dit browsertabblad in de PDF ingesloten. BrowserPDF heeft geen eindpunt voor bestandsuploads.",
    "pl": "Obrazy są osadzane w PDF lokalnie w tej karcie przeglądarki. BrowserPDF nie ma punktu przesyłania plików.",
    "id": "Gambar disematkan ke PDF secara lokal di tab browser ini. BrowserPDF tidak memiliki endpoint unggah file.",
    "vi": "Ảnh được nhúng vào PDF cục bộ trong thẻ trình duyệt này. BrowserPDF không có điểm cuối tải tệp lên.",
    "th": "รูปภาพถูกฝังลงใน PDF ภายในแท็บเบราว์เซอร์นี้แบบในเครื่อง BrowserPDF ไม่มีปลายทางสำหรับอัปโหลดไฟล์",
    "uk": "Зображення вбудовуються в PDF локально в цій вкладці браузера. BrowserPDF не має кінцевої точки завантаження файлів.",
    "cs": "Obrázky se vkládají do PDF lokálně v této kartě prohlížeče. BrowserPDF nemá koncový bod pro nahrávání souborů.",
    "sv": "Bilder bäddas in i PDF-filen lokalt i den här webbläsarfliken. BrowserPDF har ingen slutpunkt för filuppladdning.",
}

DROPZONE_ARIA_KEYS = {
    "common.dropzone_aria", "excel-to-pdf.dropzone_aria",
    "images.dropzone_img_aria", "jpg-to-pdf.dropzone_aria",
    "markdown-to-pdf.dropzone_aria", "markdown-viewer.dropzone_aria",
    "merge.dropzone_aria", "word-to-pdf.dropzone_aria",
}

PROCESSING_TITLE_KEYS = {
    "crop.about_1_title", "delete-pages.about_1_title",
    "excel-to-pdf.about_1_title", "jpg-to-pdf.about_1_title",
    "pdf-to-excel.about_1_title", "word-to-pdf.about_1_title",
}

NO_UPLOAD_TITLE_KEYS = {
    "add-image.about_3_title", "add-text.about_3_title",
    "compress.about_3_title", "crop.about_2_title",
    "delete-pages.about_2_title", "edit-metadata.about_3_title",
    "excel-to-pdf.about_2_title", "fill-sign.about_3_title",
    "highlight.about_3_title", "images.about_3_title",
    "jpg-to-pdf.about_2_title", "markdown-to-pdf.about_3_title",
    "markdown-viewer.about_4_title", "organize.about_3_title",
    "page-numbers.about_3_title", "pdf-to-excel.about_2_title",
    "protect.about_1_title", "redact.about_3_title",
    "rotate.about_3_title", "split.about_3_title",
    "unlock.about_1_title", "view-pdf.about_3_title",
    "word-to-pdf.about_2_title",
}

LOCAL_PROCESSING_BODY_KEYS = {
    "add-image.about_3_body", "add-text.about_3_body",
    "compress.about_3_body", "crop.about_1_body", "crop.about_2_body",
    "crop.no_see", "delete-pages.about_1_body",
    "delete-pages.about_2_body", "delete-pages.no_see",
    "edit-metadata.about_3_body", "excel-to-pdf.about_1_body",
    "excel-to-pdf.about_2_body", "excel-to-pdf.no_see",
    "fill-sign.about_3_body", "highlight.about_3_body",
    "images.about_3_body", "images.privacy_note",
    "jpg-to-pdf.about_1_body", "jpg-to-pdf.about_2_body",
    "jpg-to-pdf.no_see", "markdown-to-pdf.about_3_body",
    "markdown-to-pdf.privacy_note", "markdown-viewer.about_4_body",
    "markdown-viewer.privacy_note", "organize.about_3_body",
    "page-numbers.about_3_body", "pdf-to-excel.about_1_body",
    "pdf-to-excel.about_2_body", "pdf-to-excel.no_see",
    "pdf-to-word.about_2_body", "protect.about_1_body",
    "redact.about_3_body", "rotate.about_3_body",
    "split.about_3_body", "unlock.about_1_body",
    "view-pdf.about_3_body", "word-to-pdf.about_1_body",
    "word-to-pdf.about_2_body", "word-to-pdf.no_see",
}

PRIVACY_FAQ_KEYS = {
    "fill-sign.faq_3_a", "protect.faq_2_a", "unlock.faq_2_a",
    "view-pdf.faq_3_a",
}

# Keys whose entire value is the shared, reviewed privacy contract. Keeping the
# inventory explicit makes omissions and accidental per-tool drift testable.
CANONICAL_PRIVACY_KEYS = (
    LOCAL_PROCESSING_BODY_KEYS
    | PRIVACY_FAQ_KEYS
    | {
        "common.privacy_badge_title", "common.privacy_note",
        "hub.about_1_body", "hub.faq_2_a", "hub.privacy_note",
        "merge.privacy_note",
    }
)

# Intro copy always preserves the localized tool description, then uses the
# exact same per-locale privacy clause. The Word intro remains an explicit map
# below because its older hub description also contained an absolute claim.
INTRO_TOOL_KEYS = {
    "add-image.intro": "hub.tool_add_image_desc",
    "add-text.intro": "hub.tool_add_text_desc",
    "compress.intro": "hub.tool_compress_desc",
    "crop.intro": "hub.tool_crop_desc",
    "delete-pages.intro": "hub.tool_delete_pages_desc",
    "edit-metadata.intro": "hub.tool_edit_metadata_desc",
    "excel-to-pdf.intro": "hub.tool_excel_to_pdf_desc",
    "extract-text.intro": "hub.tool_extract_text_desc",
    "fill-sign.intro": "hub.tool_fill_sign_desc",
    "highlight.intro": "hub.tool_highlight_desc",
    "images.intro": "hub.tool_images_desc",
    "jpg-to-pdf.intro": "hub.tool_jpg_to_pdf_desc",
    "markdown-to-pdf.intro": "hub.tool_markdown_to_pdf_desc",
    "markdown-viewer.intro": "hub.tool_markdown_viewer_desc",
    "merge.intro": "hub.tool_merge_desc",
    "ocr-pdf.intro": "hub.tool_ocr_desc",
    "organize.intro": "hub.tool_organize_desc",
    "page-numbers.intro": "hub.tool_page_numbers_desc",
    "pdf-to-excel.intro": "hub.tool_pdf_to_excel_desc",
    "pdf-to-markdown.intro": "hub.tool_pdf_to_markdown_desc",
    "pdf-to-word.intro": "hub.tool_pdf_to_word_desc",
    "protect.intro": "hub.tool_protect_desc",
    "redact.intro": "hub.tool_redact_desc",
    "rotate.intro": "hub.tool_rotate_desc",
    "split.intro": "hub.tool_split_desc",
    "unlock.intro": "hub.tool_unlock_desc",
    "view-pdf.intro": "hub.tool_view_pdf_desc",
    "watermark.intro": "hub.tool_watermark_desc",
}

# Privacy answers/callouts that need tool context before the canonical clause.
TOOL_PRIVACY_KEYS = {
    "add-text.faq_3_a": "hub.tool_add_text_desc",
    "highlight.faq_3_a": "hub.tool_highlight_desc",
    "ocr-pdf.callout": "hub.tool_ocr_desc",
    "pdf-to-excel.faq_2_a": "hub.tool_pdf_to_excel_desc",
    "view-pdf.faq_2_a": "hub.tool_view_pdf_desc",
}


def migrate(
    locale: dict[str, str],
    pack: tuple[str, ...],
    select_files: str,
    word_to_pdf_intro: str,
    word_to_pdf_description: str,
    jpg_to_pdf_faq: str,
) -> None:
    (processing, no_upload, source, analytics, free, libraries, skip,
     no_results, clear, success, region, no_upload_title, multiple,
     javascript_required) = pack
    privacy_clause = f"{processing} {no_upload}"
    updates = {
        "common.skip_to_main": skip,
        "common.privacy_badge": processing,
        "common.privacy_badge_title": privacy_clause,
        "common.noscript": f"{privacy_clause} {javascript_required}",
        "common.privacy_note": privacy_clause,
        "common.footer_source": source,
        "hub.intro": f"{privacy_clause} {source}. {free}",
        "hub.no_results": no_results,
        "hub.clear_search": clear,
        "hub.about_1_title": no_upload_title,
        "hub.about_1_body": privacy_clause,
        "hub.about_3_title": region,
        "hub.about_3_body": analytics,
        "hub.about_4_body": free,
        "hub.faq_1_a": free,
        "hub.faq_2_a": privacy_clause,
        "hub.faq_6_a": f"{libraries} {no_upload}",
        "hub.privacy_note": privacy_clause,
        "merge.dropzone_more": multiple,
        "merge.about_2_body": f"{processing} pdf-lib. {no_upload}",
        "merge.privacy_note": privacy_clause,
        "merge.success": success,
        "consent.region_aria": region,
        "consent.text": analytics,
    }
    locale.update(updates)
    for key in DROPZONE_ARIA_KEYS:
        locale[key] = select_files
    for key in PROCESSING_TITLE_KEYS:
        locale[key] = processing
    for key in NO_UPLOAD_TITLE_KEYS:
        locale[key] = no_upload_title
    for key in CANONICAL_PRIVACY_KEYS:
        locale[key] = privacy_clause
    locale["view-pdf.about_1_body"] = f"{libraries} {privacy_clause}"
    for intro_key, description_key in INTRO_TOOL_KEYS.items():
        description = locale.get(description_key, "").strip()
        locale[intro_key] = f"{description} {privacy_clause}".strip()
    for privacy_key, description_key in TOOL_PRIVACY_KEYS.items():
        description = locale.get(description_key, "").strip()
        locale[privacy_key] = f"{description} {privacy_clause}".strip()
    locale["word-to-pdf.intro"] = word_to_pdf_intro
    locale["word-to-pdf.faq_2_a"] = word_to_pdf_intro
    locale["hub.tool_word_to_pdf_desc"] = word_to_pdf_description
    locale["jpg-to-pdf.faq_2_a"] = jpg_to_pdf_faq


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--check", action="store_true", help="fail if migration output differs")
    args = parser.parse_args()
    original = TRANSLATIONS.read_text(encoding="utf-8")
    data = json.loads(original)
    if set(data) != set(PACKS):
        missing = sorted(set(data) - set(PACKS))
        extra = sorted(set(PACKS) - set(data))
        raise SystemExit(f"locale mismatch: missing packs={missing}, unknown packs={extra}")
    if any(set(mapping) != set(PACKS) for mapping in (
        SELECT_FILES, WORD_TO_PDF_INTRO, WORD_TO_PDF_DESCRIPTION,
        JPG_TO_PDF_FAQ,
    )):
        raise SystemExit("localized Phase 1 copy locale mismatch")
    for language, locale in data.items():
        migrate(
            locale,
            PACKS[language],
            SELECT_FILES[language],
            WORD_TO_PDF_INTRO[language],
            WORD_TO_PDF_DESCRIPTION[language],
            JPG_TO_PDF_FAQ[language],
        )
    rendered = json.dumps(data, ensure_ascii=False, indent=2) + "\n"
    if args.check:
        if rendered != original:
            raise SystemExit("translations migration is not up to date")
        return
    TRANSLATIONS.write_text(rendered, encoding="utf-8")


if __name__ == "__main__":
    main()
