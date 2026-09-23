// gamedistribution/_cloner.js

(function () {
    window.GameDistribution = {
        SDK: function() {
            return {
                showBanner: function () {
                }
            }
        }
    }

    var gdsdk = new window.GameDistribution.SDK();
    window.gdsdk = gdsdk;
})();
