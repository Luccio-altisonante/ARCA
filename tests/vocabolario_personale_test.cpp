#include "../core/api.hpp"
#include "../core/ordinamento_rimario.hpp"

#include <algorithm>
#include <cassert>
#include <iostream>
#include <optional>
#include <stdexcept>
#include <string>
#include <string_view>

namespace {

void test_vocabolario_con_identita() {
    using anagrammi::Words;
    using anagrammi::carica_vocabolario_ordinato_con_identita;

    const std::string bytes = u8"roma\namor\nramo\ncitt\u00e0\n";
    const auto caricato = carica_vocabolario_ordinato_con_identita(bytes);
    assert((caricato.parole == Words{"roma", "amor", "ramo", u8"citt\u00e0"}));
    // SHA-256 indipendente, calcolato con System.Security.Cryptography.SHA256.
    assert(caricato.sha256 == "7127490e1888c658b2e752caf5213ac05562715642c4ccacd7a859b5900fb790");
    assert(carica_vocabolario_ordinato_con_identita(bytes).sha256 == caricato.sha256);

    const auto modificato = carica_vocabolario_ordinato_con_identita(u8"roma\namor\nmora\ncitt\u00e0\n");
    assert((modificato.parole == Words{"roma", "amor", "mora", u8"citt\u00e0"}));
    assert(modificato.sha256 != caricato.sha256);
    const auto riordinato = carica_vocabolario_ordinato_con_identita(u8"amor\nroma\nramo\ncitt\u00e0\n");
    assert((riordinato.parole == Words{"amor", "roma", "ramo", u8"citt\u00e0"}));
    assert(riordinato.sha256 != caricato.sha256);

    const auto duplicati = carica_vocabolario_ordinato_con_identita("roma\nroma\n");
    assert((duplicati.parole == Words{"roma", "roma"}));
    const auto vuoto = carica_vocabolario_ordinato_con_identita(std::string_view{});
    assert(vuoto.parole.empty());
    assert(vuoto.sha256 == "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");

    const Words non_canonici = {
        "roma\namor", "roma\r\namor\r\n", "\xef\xbb\xbfroma\n",
        "roma\n\namor\n", "\nroma\n", "roma\n\n", "ROMA\n", " roma \n",
        u8"citta\u0300\n", "roma\r", std::string("\xff\n", 2)
    };
    for (const auto& input : non_canonici) {
        std::optional<anagrammi::VocabolarioConIdentita> risultato;
        bool rifiutato = false;
        try {
            risultato = carica_vocabolario_ordinato_con_identita(input);
        } catch (const std::invalid_argument&) {
            rifiutato = true;
        }
        assert(rifiutato);
        assert(!risultato.has_value());
    }

    auto precedente = caricato;
    bool rifiutato = false;
    try {
        precedente = carica_vocabolario_ordinato_con_identita("ROMA\n");
    } catch (const std::invalid_argument&) {
        rifiutato = true;
    }
    assert(rifiutato);
    assert(precedente.parole == caricato.parole);
    assert(precedente.sha256 == caricato.sha256);

    // I percorsi esistenti restano permissivi e restituiscono solo Words/testo.
    anagrammi::MotoreAnagrammi personale;
    personale.carica_vocabolario_ordinato_da_testo(" ROMA \r\n\namor");
    assert((personale.vocabolario() == Words{"roma", "amor"}));
    assert(personale.esporta_vocabolario_testo() == "roma\namor\n");
    const Words prima = personale.vocabolario();
    const auto separato = carica_vocabolario_ordinato_con_identita(bytes);
    assert(personale.vocabolario() == prima);
    assert(separato.sha256 == caricato.sha256);

    personale.carica_vocabolario_ordinato_da_testo("\xef\xbb\xbfroma\n");
    assert((personale.vocabolario() == Words{"\xef\xbb\xbfroma"}));
    personale.carica_vocabolario_da_testo(" EXTRA \r\n\nala");
    assert((personale.vocabolario() == Words{"ala", "extra"}));
    assert(personale.esporta_vocabolario_testo() == "ala\nextra\n");
}

} // namespace

int main() {
    using anagrammi::Words;

    test_vocabolario_con_identita();

    Words originale = {"extra", "era", "anta", "arma", "asia", "aria", "ala", "afa", "xyz"};
    anagrammi::ordina_rimario(originale);

    anagrammi::MotoreAnagrammi personale(originale);
    assert(personale.rimuovi_parola("aria"));

    Words dopo_rimozione = originale;
    dopo_rimozione.erase(std::find(dopo_rimozione.begin(), dopo_rimozione.end(), "aria"));
    assert(personale.vocabolario() == dopo_rimozione);

    assert(personale.aggiungi_parola("acca"));
    assert(anagrammi::e_ordinato_rimario(personale.vocabolario()));

    anagrammi::MotoreAnagrammi ricostruito(originale);
    ricostruito.applica_modifiche(Words{"aria"}, Words{"acca"});
    assert(ricostruito.vocabolario() == personale.vocabolario());

    anagrammi::MotoreAnagrammi ricaricato;
    ricaricato.carica_vocabolario_da_testo(personale.esporta_vocabolario_testo());
    assert(ricaricato.vocabolario() == personale.vocabolario());
    assert(anagrammi::e_ordinato_rimario(ricaricato.vocabolario()));

    anagrammi::MotoreAnagrammi locale_disordinato;
    locale_disordinato.carica_vocabolario_da_testo(" EXTRA \nafa\nera\nala\n");
    assert((locale_disordinato.vocabolario() == Words{"afa", "ala", "era", "extra"}));
    assert(anagrammi::e_ordinato_rimario(locale_disordinato.vocabolario()));
    assert(locale_disordinato.esporta_vocabolario_testo() == "afa\nala\nera\nextra\n");

    anagrammi::MotoreAnagrammi base_persistita;
    base_persistita.carica_vocabolario_ordinato_da_testo(locale_disordinato.esporta_vocabolario_testo());
    assert(base_persistita.vocabolario() == locale_disordinato.vocabolario());
    assert(locale_disordinato.aggiungi_parola("acca"));
    assert((locale_disordinato.vocabolario() == Words{"afa", "ala", "acca", "era", "extra"}));
    assert(anagrammi::e_ordinato_rimario(locale_disordinato.vocabolario()));

    Words dopo_aggiunta = locale_disordinato.vocabolario();
    dopo_aggiunta.erase(std::find(dopo_aggiunta.begin(), dopo_aggiunta.end(), "era"));
    assert(locale_disordinato.rimuovi_parola("era"));
    assert(locale_disordinato.vocabolario() == dopo_aggiunta);
    assert(anagrammi::e_ordinato_rimario(locale_disordinato.vocabolario()));

    anagrammi::MotoreAnagrammi ufficiale;
    anagrammi::MotoreAnagrammi base_ufficiale(originale);
    ufficiale.carica_vocabolario_ordinato_da_testo(base_ufficiale.esporta_vocabolario_testo());
    assert(ufficiale.vocabolario() == originale);
    assert(anagrammi::e_ordinato_rimario(ufficiale.vocabolario()));

    anagrammi::MotoreAnagrammi export_ricaricato;
    export_ricaricato.carica_vocabolario_da_testo(locale_disordinato.esporta_vocabolario_testo());
    assert(export_ricaricato.vocabolario() == locale_disordinato.vocabolario());
    assert(anagrammi::e_ordinato_rimario(export_ricaricato.vocabolario()));

    std::cout << "Test vocabolario personale superati.\n";
    return 0;
}
