
# İNDİVA Admin Paneli - Yönetici (Admin) Kurulumu

Bu doküman, İNDİVA admin panelinin kimlik doğrulama altyapısını kurmayı ve yönetici yetkilerini anlamayı açıklar.

## 0. Gerekli Kurulum: Anonim Girişi Etkinleştirme
Mevcut uygulama, Firestore işlemlerini yetkilendirmek için arka planda anonim olarak oturum açar. Bu özelliğin çalışabilmesi için Firebase projenizde anonim girişi etkinleştirmeniz **GEREKLİDİR**. `auth/admin-restricted-operation` hatası alıyorsanız sebebi budur.

1. Firebase Console'da projenizi açın.
2. Sol menüden **Authentication**'a gidin.
3. **Sign-in method** sekmesine tıklayın.
4. Listeden **Anonymous** (Anonim) sağlayıcısını bulun, üzerine tıklayın ve **Enable** (Etkinleştir) seçeneğini aktif hale getirip kaydedin.


## 1. Firebase Projesi Kimlik Doğrulama Ayarları (Google Girişi İçin)

### a) Google ile Girişi Aktif Etme
1.  Firebase Console'da projenizi açın.
2.  Sol menüden **Authentication**'a gidin.
3.  **Sign-in method** sekmesine tıklayın.
4.  Sign-in provider listesinden **Google**'ı bulun, üzerine tıklayın ve **Enable** (Etkinleştir) seçeneğini aktif hale getirin.
5.  Proje için bir destek e-postası seçin ve kaydedin.

### b) Yetkili Alan Adı (Authorized Domain) Ekleme
Giriş yapmaya çalışırken `auth/unauthorized-domain` hatası alıyorsanız, bu adımı uygulamanız gerekir.

1.  Yine **Authentication > Sign-in method** sekmesinde, sayfanın alt kısmındaki **Authorized domains** listesini bulun.
2.  Uygulamanızın çalıştığı alan adını bu listeye eklemeniz gerekir. Ekranda çıkan hata mesajı, hangi alan adını eklemeniz gerektiğini size söyleyecektir.
3.  **Add domain** butonuna tıklayın ve gerekli alan adını (örneğin, `projeniz.web.app` veya `localhost`) listeye ekleyin.

## 2. Yönetici (Admin) Yetkisi Atama