#ifndef ANAGRAMMI_VOCABOLARIO_HPP
#define ANAGRAMMI_VOCABOLARIO_HPP

#include <string>
#include <vector>

namespace anagrammi {

using Words = std::vector<std::string>;

Words normalizza_vocabolario(const Words& words);

bool aggiungi_parola(Words& vocabulary, const std::string& word);
bool inserisci_parola_ordinata(Words& vocabulary, const std::string& word);
bool rimuovi_parola(Words& vocabulary, const std::string& word);

} // namespace anagrammi

#endif
