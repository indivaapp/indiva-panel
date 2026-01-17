import { db } from '../firebaseConfig';
import { doc, deleteDoc } from 'firebase/firestore';

/**
 * ImgBB'ye yüklenmiş bir görseli silme denemesi yapar.
 * Bu, resmi bir API olmamasına rağmen, silme URL'sine istek göndererek çalışır.
 * Tarayıcı CORS kısıtlamaları nedeniyle yanıtı okuyamayabiliriz, bu yüzden "no-cors" modu kullanılır.
 * @param deleteUrl ImgBB tarafından sağlanan silme URL'si.
 * @throws Ağ hatası durumunda bir Error fırlatır.
 */
export async function deleteImgbb(deleteUrl: string): Promise<void> {
    if (!deleteUrl || !deleteUrl.startsWith('http')) {
        // Geçerli bir URL yoksa hata fırlatıyoruz.
        throw new Error("Geçersiz veya sağlanmamış ImgBB silme URL'si.");
    }

    try {
        // Pratikte, bazen DELETE, bazen POST metodu çalıştığı gözlemlenmiştir.
        // İkisini de deneyerek silme şansını artırıyoruz.
        
        // Önce DELETE metodunu dene
        await fetch(deleteUrl, { method: "DELETE", mode: "no-cors" });
        
        // Kısa bir bekleme süresinin ardından POST ile garantileme
        await new Promise(resolve => setTimeout(resolve, 500));
        
        // `catch` ile özellikle POST isteğinin hatasını yutuyoruz, çünkü DELETE başarılı olmuş olabilir.
        // Asıl amaç en az bir isteğin hedefe ulaşması.
        fetch(deleteUrl, { method: "POST", mode: "no-cors" }).catch(() => {
            // Bu hatayı görmezden geliyoruz, çünkü `no-cors` ile zaten yanıtı işleyemeyiz
            // ve ana `try/catch` bloğu genel ağ sorunlarını yakalayacaktır.
        });

    } catch (error) {
        // Bu blok genellikle ağ bağlantısı sorunları gibi temel fetch hatalarında tetiklenir.
        console.error("ImgBB silme isteği sırasında ağ hatası:", error);
        throw new Error("Görsel silinirken bir ağ hatası oluştu. Lütfen internet bağlantınızı kontrol edin.");
    }
}