#include "../core/api.hpp"
#include "../core/testo.hpp"
#include "vocabolario_file.hpp"

#include <exception>
#include <iostream>
#include <string>
#include <utility>

namespace {

void stampa_risultato(const anagrammi::RisultatoComando& result) {
    if (!result.messaggio.empty()) {
        std::cout << result.messaggio << "\n\n";
        return;
    }

    for (const auto& row : result.righe) {
        std::cout << row << '\n';
    }
    std::cout << result.footer << "\n\n";
}

void stampa_aiuto() {
    std::cout
        << "Input disponibili:\n"
        << "  parola              cerca anagrammi lunghi quanto la parola\n"
        << "  parola N            cerca anagrammi formabili lunghi N, mostrando le lettere avanzate\n"
        << "  ?asa                sostituisce ? con lettere qualsiasi nella stessa posizione\n"
        << "  *a??a               combina * e ?: qualunque prefisso, poi a, due lettere, a\n"
        << "  conta*              parole che iniziano con 'conta'\n"
        << "  *conta              parole che finiscono con 'conta'\n"
        << "  *conta*             parole che contengono 'conta'\n"
        << "  &lettere            parole che contengono tutte quelle lettere, incluse ripetizioni\n"
        << "  !lettere            parole che non contengono nessuna di quelle lettere\n"
        << "  $lettere            parole formabili usando solo quelle lettere\n"
        << "  ^,quante,caratteri  estrae parole casuali dal vocabolario\n"
        << "  + parola            aggiunge una parola al vocabolario e salva il file\n"
        << "  - parola            elimina una parola dal vocabolario e salva il file\n"
        << "  :help               mostra questo aiuto\n"
        << "  :quit               esce\n\n";
}

} // namespace

int main(int argc, char* argv[]) {
    const std::string dictionary_path = argc > 1 ? argv[1] : "VocabolarioItaliano.txt";
    anagrammi::Words vocabulary = anagrammi_console::carica_vocabolario_da_file(dictionary_path);

    if (vocabulary.empty()) {
        if (argc > 1) {
            std::cerr << "Vocabolario non trovato o vuoto: " << dictionary_path << '\n';
        } else {
            std::cerr << "VocabolarioItaliano.txt non trovato o vuoto nella directory corrente.\n"
                      << "Avvia il programma dalla directory che contiene il file oppure passa il percorso come primo argomento.\n";
        }
        return 1;
    }

    anagrammi::MotoreAnagrammi motore(std::move(vocabulary));
    std::cout << "ARCA - versione C++ console\n";
    std::cout << motore.numero_parole() << " parole caricate da " << dictionary_path << "\n";
    stampa_aiuto();

    for (;;) {
        std::cout << "> ";
        std::string input;
        if (!std::getline(std::cin, input)) {
            break;
        }

        input = anagrammi::normalizza_testo(input);
        if (input.empty()) {
            continue;
        }
        if (input == ":quit" || input == "quit" || input == "exit") {
            break;
        }
        if (input == ":help" || input == "help") {
            stampa_aiuto();
            continue;
        }

        try {
            const anagrammi::RisultatoComando result = motore.esegui_comando(input);
            if (result.richiede_salvataggio) {
                anagrammi_console::salva_vocabolario_su_file(dictionary_path, motore.vocabolario());
            }

            stampa_risultato(result);
        } catch (const std::exception& ex) {
            std::cout << "Input non valido: " << ex.what() << "\n\n";
        }
    }

    return 0;
}
